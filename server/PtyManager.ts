import { ChildProcess, spawn } from 'child_process';
import type { Room } from './types';

const PTY_OUTPUT_TYPE = 0x01;

let ptyModule: any = null;
try {
  ptyModule = require('node-pty');
} catch {
  console.log('[PtyManager] node-pty not available, will use child_process fallback');
}

interface PtyLike {
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: () => void): void;
}

// Fallback using child_process when node-pty can't spawn
class ChildProcessPty implements PtyLike {
  private proc: ChildProcess;
  private dataHandlers: ((data: string) => void)[] = [];
  private exitHandlers: (() => void)[] = [];

  constructor(shell: string, cwd: string, env: Record<string, string>) {
    this.proc = spawn(shell, ['-i'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...env, TERM: 'xterm-256color' },
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8');
      for (const h of this.dataHandlers) h(str);
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8');
      for (const h of this.dataHandlers) h(str);
    });

    this.proc.on('exit', () => {
      for (const h of this.exitHandlers) h();
    });

    this.proc.on('error', (err) => {
      console.error('[ChildProcessPty] Error:', err.message);
    });
  }

  write(data: string): void {
    // Echo input to data handlers (child_process has no TTY echo)
    // Echo printable chars and handle Enter (\r → \r\n), but not control sequences
    for (const ch of data) {
      if (ch === '\r') {
        for (const h of this.dataHandlers) h('\r\n');
      } else if (ch === '\x7f') {
        // Backspace: move back, erase, move back
        for (const h of this.dataHandlers) h('\b \b');
      } else if (ch >= ' ') {
        for (const h of this.dataHandlers) h(ch);
      }
    }
    // Convert \r to \n for child_process stdin
    const converted = data.replace(/\r/g, '\n');
    this.proc.stdin?.write(converted);
  }

  resize(): void {
    // No resize support in child_process fallback
  }

  kill(): void {
    try {
      this.proc.kill();
    } catch {
      // already dead
    }
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: () => void): void {
    this.exitHandlers.push(handler);
  }
}

interface PtyInstance {
  pty: PtyLike;
  batcher: PtyOutputBatcher;
  outputBuffer: OutputBuffer;
}

class PtyOutputBatcher {
  private buffer: Buffer[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private flush: (data: Buffer) => void) {}

  push(data: Buffer) {
    this.buffer.push(data);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        const combined = Buffer.concat(this.buffer);
        this.buffer = [];
        this.timer = null;
        this.flush(combined);
      }, 16);
    }
  }

  destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}

class OutputBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private maxBytes: number;

  constructor(maxBytes = 512 * 1024) {
    this.maxBytes = maxBytes;
  }

  append(data: Buffer) {
    this.chunks.push(data);
    this.totalBytes += data.length;
    while (this.totalBytes > this.maxBytes && this.chunks.length > 1) {
      const evicted = this.chunks.shift()!;
      this.totalBytes -= evicted.length;
    }
  }

  getAll(): Buffer {
    return Buffer.concat(this.chunks);
  }

  clear() {
    this.chunks = [];
    this.totalBytes = 0;
  }
}

export class PtyManager {
  private instances: Map<string, PtyInstance> = new Map();

  private key(roomCode: string, terminalId: string) {
    return `${roomCode}:${terminalId}`;
  }

  hasPty(roomCode: string, terminalId: string): boolean {
    return this.instances.has(this.key(roomCode, terminalId));
  }

  spawnPty(room: Room, terminalId: string, cols: number = 80, rows: number = 24): void {
    let shell = process.env.SHELL || '/bin/bash';
    let shellArgs: string[] = [];
    const k = this.key(room.code, terminalId);

    // Don't double-spawn
    if (this.instances.has(k)) return;

    const env: { [key: string]: string } = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined && key !== 'CLAUDECODE') env[key] = val;
    }
    // Ensure color support is advertised to programs running in the PTY
    env.COLORTERM = 'truecolor';
    env.TERM = 'xterm-256color';
    env.FORCE_COLOR = '3';

    // Claude Code mode: spawn claude instead of shell
    if (room.mode === 'claude-code') {
      shell = 'claude';
      shellArgs = [];
      if ((room as any).__apiKey) {
        env.ANTHROPIC_API_KEY = (room as any).__apiKey;
      }
      if ((room as any).__project) {
        shellArgs.push('--project', (room as any).__project);
      }
    }

    let ptyProcess: PtyLike;

    // Try node-pty first, fall back to child_process
    if (ptyModule) {
      try {
        const p = ptyModule.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: env.HOME || '/tmp',
          env,
        });
        ptyProcess = {
          write: (data: string) => p.write(data),
          resize: (cols: number, rows: number) => p.resize(cols, rows),
          kill: () => p.kill(),
          onData: (handler: (data: string) => void) => p.onData(handler),
          onExit: (handler: () => void) => p.onExit(handler),
        };
        console.log(`[PtyManager] Spawned PTY via node-pty for terminal ${terminalId}`);
      } catch (err) {
        console.warn('[PtyManager] node-pty spawn failed, using child_process fallback:', (err as Error).message);
        ptyProcess = new ChildProcessPty(shell, env.HOME || '/tmp', env);
        console.log(`[PtyManager] Spawned PTY via child_process for terminal ${terminalId}`);
      }
    } else {
      ptyProcess = new ChildProcessPty(shell, env.HOME || '/tmp', env);
      console.log(`[PtyManager] Spawned PTY via child_process for terminal ${terminalId}`);
    }

    const batcher = new PtyOutputBatcher((data: Buffer) => {
      this.broadcastPtyOutput(room, terminalId, data);
    });

    const outputBuffer = new OutputBuffer();

    ptyProcess.onData((rawData: string) => {
      const buf = Buffer.from(rawData, 'utf-8');
      outputBuffer.append(buf);
      batcher.push(buf);
    });

    ptyProcess.onExit(() => {
      const inst = this.instances.get(k);
      if (inst) {
        inst.batcher.destroy();
        this.instances.delete(k);
      }
    });

    this.instances.set(k, { pty: ptyProcess, batcher, outputBuffer });
  }

  private broadcastPtyOutput(room: Room, terminalId: string, data: Buffer) {
    const tidBuf = Buffer.from(terminalId, 'utf-8');
    const frame = Buffer.alloc(1 + 1 + tidBuf.length + data.length);
    frame[0] = PTY_OUTPUT_TYPE;
    frame[1] = tidBuf.length;
    tidBuf.copy(frame, 2);
    data.copy(frame, 2 + tidBuf.length);

    for (const user of room.users.values()) {
      if (user.ws.readyState === 1) {
        try {
          user.ws.send(frame);
        } catch {
          // ignore
        }
      }
    }
  }

  getOutputBuffer(roomCode: string, terminalId: string): Buffer {
    const inst = this.instances.get(this.key(roomCode, terminalId));
    return inst ? inst.outputBuffer.getAll() : Buffer.alloc(0);
  }

  writeToPty(roomCode: string, terminalId: string, data: string): void {
    const inst = this.instances.get(this.key(roomCode, terminalId));
    if (inst) {
      inst.pty.write(data);
    }
  }

  resizePty(roomCode: string, terminalId: string, cols: number, rows: number): void {
    const inst = this.instances.get(this.key(roomCode, terminalId));
    if (inst?.pty.resize) {
      try {
        inst.pty.resize(cols, rows);
      } catch {
        // ignore
      }
    }
  }

  killPty(roomCode: string, terminalId: string): void {
    const k = this.key(roomCode, terminalId);
    const inst = this.instances.get(k);
    if (inst) {
      inst.batcher.destroy();
      try {
        inst.pty.kill();
      } catch {
        // already dead
      }
      this.instances.delete(k);
    }
  }

  killAllPtys(roomCode: string): void {
    const prefix = `${roomCode}:`;
    const toDelete: string[] = [];
    for (const [k, inst] of this.instances) {
      if (k.startsWith(prefix)) {
        inst.batcher.destroy();
        try {
          inst.pty.kill();
        } catch {
          // already dead
        }
        toDelete.push(k);
      }
    }
    for (const k of toDelete) {
      this.instances.delete(k);
    }
  }
}
