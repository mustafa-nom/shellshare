import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './RoomManager';
import { CommandHandler } from './CommandHandler';
import type { ClientMessage, Message } from './types';

const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);

const roomManager = new RoomManager();
const commandHandler = new CommandHandler(roomManager);

// Track which userId is associated with each WebSocket
const wsUserMap = new Map<WebSocket, string>();
const wsRoomMap = new Map<WebSocket, string>();

// HTTP server for REST endpoints + WebSocket upgrade
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/roulette') {
    const room = roomManager.getRandomOpenRoom();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (room) {
      const users = Array.from(room.users.values()).map(u => ({
        name: u.name,
        color: u.color,
      }));
      res.end(JSON.stringify({ roomCode: room.code, users }));
    } else {
      res.end(JSON.stringify({ roomCode: null }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/rooms/status') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { codes } = JSON.parse(body) as { codes: string[] };
        const statuses: Record<string, { exists: boolean; users: number; locked: boolean }> = {};
        for (const code of codes) {
          const room = roomManager.getRoom(code);
          if (room) {
            statuses[code] = {
              exists: true,
              users: room.users.size,
              locked: room.locked,
            };
          } else {
            statuses[code] = { exists: false, users: 0, locked: false };
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(statuses));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({
  server: httpServer,
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    threshold: 128,
  },
});

httpServer.listen(WS_PORT, () => {
  console.log(`[ShellShare] Server running on port ${WS_PORT} (HTTP + WebSocket)`);
});

wss.on('connection', (ws: WebSocket) => {
  let joined = false;

  ws.on('message', (rawData: Buffer | string, isBinary: boolean) => {
    // Binary messages are not expected from client in this protocol
    if (isBinary) {
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    // First message must be join or reconnect
    if (!joined && msg.type !== 'join' && msg.type !== 'reconnect' && msg.type !== 'roulette_request') {
      roomManager.sendTo(ws, { type: 'error', message: 'Must join a room first.' });
      return;
    }

    switch (msg.type) {
      case 'join': {
        if (joined) return;

        const userName = (msg.userName || '').trim().slice(0, 20);
        if (!userName) {
          roomManager.sendTo(ws, { type: 'error', message: 'Name is required.' });
          return;
        }

        if (msg.roomCode === 'CREATE' || msg.roomCode.startsWith('CREATE:')) {
          // Create a new room
          const visibility = msg.roomCode.includes(':open') ? 'open' : 'private';
          const mode = msg.mode === 'claude-code' ? 'claude-code' : 'normal';
          const { room, user } = roomManager.createRoom(ws, userName, visibility as 'private' | 'open', mode);
          // Store API key for Claude Code mode PTY spawn
          if (mode === 'claude-code' && msg.apiKey) {
            (room as any).__apiKey = msg.apiKey;
            (room as any).__project = msg.project;
          }
          wsUserMap.set(ws, user.id);
          wsRoomMap.set(ws, room.code);
          joined = true;

          roomManager.sendTo(ws, {
            type: 'room_state',
            room: roomManager.getRoomState(room),
            userId: user.id,
            sessionToken: user.sessionToken,
          });

          const createBuffers = roomManager.getTerminalBuffers(room.code);
          if (createBuffers.length > 0) {
            roomManager.sendTo(ws, { type: 'pty_replay', buffers: createBuffers });
          }
        } else {
          // Join existing room
          const result = roomManager.joinRoom(msg.roomCode, ws, userName);
          if ('error' in result) {
            roomManager.sendTo(ws, { type: 'error', message: result.error });
            return;
          }

          const { room, user } = result;
          wsUserMap.set(ws, user.id);
          wsRoomMap.set(ws, room.code);
          joined = true;

          roomManager.sendTo(ws, {
            type: 'room_state',
            room: roomManager.getRoomState(room),
            userId: user.id,
            sessionToken: user.sessionToken,
          });

          const joinBuffers = roomManager.getTerminalBuffers(room.code);
          if (joinBuffers.length > 0) {
            roomManager.sendTo(ws, { type: 'pty_replay', buffers: joinBuffers });
          }
        }
        break;
      }

      case 'reconnect': {
        if (joined) return;

        const result = roomManager.reconnectUser(msg.sessionToken, ws);
        if ('error' in result) {
          roomManager.sendTo(ws, { type: 'reconnect_failed', reason: result.error });
          return;
        }

        const { room: reconRoom, user: reconUser } = result;
        wsUserMap.set(ws, reconUser.id);
        wsRoomMap.set(ws, reconRoom.code);
        joined = true;

        roomManager.sendTo(ws, {
          type: 'room_state',
          room: roomManager.getRoomState(reconRoom),
          userId: reconUser.id,
          sessionToken: reconUser.sessionToken,
        });

        const reconBuffers = roomManager.getTerminalBuffers(reconRoom.code);
        if (reconBuffers.length > 0) {
          roomManager.sendTo(ws, { type: 'pty_replay', buffers: reconBuffers });
        }
        break;
      }

      case 'chat': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;

        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const user = room.users.get(userId);
        if (!user) return;

        const text = (msg.text || '').trim();
        if (!text) return;

        const message: Message = {
          type: 'user',
          userId: user.id,
          userName: user.name,
          color: user.color,
          text,
          ts: Date.now(),
        };

        roomManager.addMessage(room, message);

        // Clear typing
        roomManager.clearTyping(roomCode, userId);
        break;
      }

      case 'command': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;

        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const user = room.users.get(userId);
        if (!user) return;

        commandHandler.handleCommand(room, user, msg.text);
        break;
      }

      case 'pty_input': {
        const roomCode = wsRoomMap.get(ws);
        const userId = wsUserMap.get(ws);
        if (!roomCode || !userId) return;

        // Gate input in Claude Code mode: only driver can type
        if (!roomManager.isDriver(roomCode, userId)) {
          roomManager.sendTo(ws, { type: 'error', message: 'Spectating — request control first (/drive)' });
          return;
        }

        roomManager.ptyManager.writeToPty(roomCode, msg.terminalId, msg.input);
        break;
      }

      case 'typing': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;

        if (msg.isTyping) {
          roomManager.setTyping(roomCode, userId);
        } else {
          roomManager.clearTyping(roomCode, userId);
          // Broadcast updated typing state
          const room = roomManager.getRoom(roomCode);
          if (room) {
            // The clearTyping doesn't broadcast, so we trigger it via setTyping logic
          }
        }
        break;
      }

      case 'new_terminal': {
        const roomCode = wsRoomMap.get(ws);
        if (!roomCode) return;
        roomManager.createTerminal(roomCode);
        break;
      }

      case 'close_terminal': {
        const roomCode = wsRoomMap.get(ws);
        if (!roomCode) return;
        roomManager.closeTerminal(roomCode, msg.terminalId);
        break;
      }

      case 'rename_terminal': {
        const roomCode = wsRoomMap.get(ws);
        if (!roomCode) return;
        const label = (msg.label || '').trim().slice(0, 15);
        if (label) {
          roomManager.renameTerminal(roomCode, msg.terminalId, label);
        }
        break;
      }

      case 'resize': {
        const roomCode = wsRoomMap.get(ws);
        const resizeUserId = wsUserMap.get(ws);
        if (!roomCode || !resizeUserId) return;

        const resizeRoom = roomManager.getRoom(roomCode);
        if (!resizeRoom) return;

        // In Claude Code mode, only the driver can resize the PTY
        if (resizeRoom.mode === 'claude-code' && resizeRoom.driverId !== resizeUserId) {
          // Silently ignore spectator resize
          return;
        }

        // Spawn PTY lazily on first resize so it uses the client's actual dimensions
        if (!roomManager.ptyManager.hasPty(roomCode, msg.terminalId)) {
          roomManager.ptyManager.spawnPty(resizeRoom, msg.terminalId, msg.cols, msg.rows);
        } else {
          roomManager.ptyManager.resizePty(roomCode, msg.terminalId, msg.cols, msg.rows);
        }

        // Broadcast PTY dimensions to all users
        roomManager.broadcast(resizeRoom, {
          type: 'pty_dimensions',
          terminalId: msg.terminalId,
          cols: msg.cols,
          rows: msg.rows,
        });
        break;
      }

      case 'roulette_request': {
        const randomRoom = roomManager.getRandomOpenRoom();
        if (randomRoom) {
          roomManager.sendTo(ws, { type: 'roulette_match', roomCode: randomRoom.code });
        } else {
          roomManager.sendTo(ws, { type: 'roulette_no_match' });
        }
        break;
      }

      case 'set_visibility': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.setVisibility(roomCode, userId, msg.visibility);
        break;
      }

      case 'drive_request': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.requestDrive(roomCode, userId);
        break;
      }

      case 'drive_release': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.releaseDrive(roomCode, userId);
        break;
      }

      case 'suggestion': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.sendSuggestion(roomCode, userId, msg.text);
        break;
      }

      case 'accept_suggestion': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.acceptSuggestionById(roomCode, userId, msg.suggestionId);
        break;
      }

      case 'reject_suggestion': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.rejectSuggestionById(roomCode, userId, msg.suggestionId);
        break;
      }

      case 'add_phase': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.addPhase(roomCode, userId, msg.name);
        break;
      }

      case 'update_phase': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.updatePhase(roomCode, userId, msg.phaseId, msg.status);
        break;
      }

      case 'remove_phase': {
        const userId = wsUserMap.get(ws);
        const roomCode = wsRoomMap.get(ws);
        if (!userId || !roomCode) return;
        roomManager.removePhase(roomCode, userId, msg.phaseId);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const userId = wsUserMap.get(ws);
    if (userId) {
      roomManager.disconnectUser(userId);
      wsUserMap.delete(ws);
      wsRoomMap.delete(ws);
    }
  });

  ws.on('error', () => {
    // handled by close
  });
});

// Suggestion expiry cleanup every 60s
setInterval(() => {
  roomManager.cleanupExpiredSuggestions();
}, 60000);

// Heartbeat to detect dead connections
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if ((ws as any).__isAlive === false) {
      ws.terminate();
      return;
    }
    (ws as any).__isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

wss.on('connection', (ws) => {
  (ws as any).__isAlive = true;
  ws.on('pong', () => {
    (ws as any).__isAlive = true;
  });
});
