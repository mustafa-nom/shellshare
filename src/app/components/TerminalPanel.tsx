'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, UserInfo, Suggestion } from '../lib/types';
import { XTERM_THEME } from '../lib/constants';
import SuggestionPanel from './SuggestionPanel';

interface TerminalPanelProps {
  terminalId: string;
  isActive: boolean;
  messages: Message[];
  typingUsers: { id: string; name: string; color: string }[];
  userId: string | null;
  users: UserInfo[];
  isAdmin: boolean;
  sendChat: (text: string) => void;
  sendCommand: (text: string) => void;
  sendPtyInput: (terminalId: string, input: string) => void;
  sendTyping: (isTyping: boolean) => void;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => void;
  onPtyOutput: (handler: (terminalId: string, data: string) => void) => () => void;
  isMobile: boolean;
  mobileView: 'terminal' | 'chat';
  mode?: 'normal' | 'claude-code';
  myRole?: 'driver' | 'spectator' | null;
  suggestions?: Suggestion[];
  onAcceptSuggestion?: (id: string) => void;
  onRejectSuggestion?: (id: string) => void;
}

function getHelpText(isAdmin: boolean, mode?: string): string {
  let text = `Available commands:
  /help          — Show this help
  /users         — List connected users
  /clear         — Clear chat (admin clears for all)
  /name <name>   — Change your display name
  /color <color> — Change your color`;

  if (isAdmin) {
    text += `
  /kick <user>   — Kick a user (admin only)
  /lock          — Lock the room (admin only)
  /unlock        — Unlock the room (admin only)
  /public        — Make room visible in Shell Roulette (admin only)
  /private       — Hide room from Shell Roulette (admin only)`;
  }

  text += `
  /cowsay <text> — Display ASCII cow art
  /matrix        — Trigger matrix rain animation`;

  if (mode === 'claude-code') {
    text += `
  /drive         — Request to become driver
  /release       — Release driver control
  /suggest <text> — Suggest input to driver
  /accept [n]    — Accept suggestion (driver only)
  /reject [n]    — Reject suggestion (driver only)
  /phase add/start/done/remove <name>
  /phases        — List all milestones`;
  }

  return text;
}

export default function TerminalPanel({
  terminalId,
  isActive,
  messages,
  typingUsers,
  userId,
  users,
  isAdmin,
  sendChat,
  sendCommand,
  sendPtyInput,
  sendTyping,
  resizeTerminal,
  onPtyOutput,
  isMobile,
  mobileView,
  mode,
  myRole,
  suggestions,
  onAcceptSuggestion,
  onRejectSuggestion,
}: TerminalPanelProps) {
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState('');
  const [splitPercent, setSplitPercent] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalId || xtermRef.current || !xtermContainerRef.current) return;

    let terminal: any;
    let fitAddon: any;
    let disposed = false;

    const init = async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');

      if (disposed || !xtermContainerRef.current) return;

      terminal = new Terminal({
        theme: XTERM_THEME,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
        fontSize: isMobile ? 14 : 13,
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 10000,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      if (xtermContainerRef.current) {
        terminal.open(xtermContainerRef.current);
        fitAddon.fit();
        terminal.focus();
      }

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Send keystrokes to PTY
      terminal.onData((data: string) => {
        sendPtyInput(terminalId, data);
      });

      // Report initial size
      resizeTerminal(terminalId, terminal.cols, terminal.rows);
    };

    init();

    return () => {
      disposed = true;
      if (terminal) terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId, resizeTerminal, sendPtyInput]);

  // Handle PTY output with RAF batching
  useEffect(() => {
    let pendingData = '';
    let rafScheduled = false;

    const flushPending = () => {
      if (pendingData && xtermRef.current) {
        xtermRef.current.write(pendingData);
        pendingData = '';
        rafScheduled = false;
      } else if (pendingData) {
        // xterm not initialized yet, retry next frame
        requestAnimationFrame(flushPending);
      } else {
        rafScheduled = false;
      }
    };

    const unsubscribe = onPtyOutput((tid: string, data: string) => {
      if (tid !== terminalId) return;
      pendingData += data;

      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushPending);
      }
    });

    return () => unsubscribe();
  }, [onPtyOutput, terminalId]);

  // Refit and focus when tab becomes active (was display:none, now visible)
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        if (xtermRef.current) {
          resizeTerminal(terminalId, xtermRef.current.cols, xtermRef.current.rows);
          xtermRef.current.focus();
        }
      });
    }
  }, [isActive, terminalId, resizeTerminal]);

  // Resize on container change
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        resizeTerminal(
          terminalId,
          xtermRef.current.cols,
          xtermRef.current.rows
        );
      }
    });

    if (xtermContainerRef.current) {
      observer.observe(xtermContainerRef.current);
    }

    return () => observer.disconnect();
  }, [resizeTerminal]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, localMessages]);

  // Drag handle for split pane
  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  }, []);

  const handleTouchStart = useCallback(() => {
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitPercent(Math.min(85, Math.max(20, percent)));
      // Refit xterm during drag for smoother experience
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      // Final refit after drag
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.touches[0].clientY - rect.top) / rect.height) * 100;
      setSplitPercent(Math.min(85, Math.max(20, percent)));
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging]);

  // Handle chat input
  const handleChatSubmit = () => {
    const text = chatInput.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      // Client-side commands
      if (text === '/help') {
        setLocalMessages((prev) => [
          ...prev,
          { type: 'system', text: getHelpText(isAdmin, mode), ts: Date.now() },
        ]);
      } else if (text === '/users') {
        const userList = users
          .map((u) => {
            const roleIcon = u.role === 'driver' ? '\u25B6 ' : u.role === 'spectator' ? '\u25C9 ' : '';
            const adminIcon = u.isAdmin ? '\u2605 ' : '  ';
            const roleLabel = u.role ? ` ${u.role}` : '';
            const youLabel = u.id === userId ? ' <- you' : '';
            return `  ${adminIcon}${roleIcon}${u.name} (${u.colorName})${roleLabel}${youLabel}`;
          })
          .join('\n');
        setLocalMessages((prev) => [
          ...prev,
          { type: 'system', text: `Connected users:\n${userList}`, ts: Date.now() },
        ]);
      } else if (text === '/clear' && !isAdmin) {
        setLocalMessages([]);
      } else {
        // Send to server
        sendCommand(text);
      }
    } else {
      sendChat(text);
    }

    setChatInput('');
    sendTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const handleChatInputChange = (value: string) => {
    setChatInput(value);
    if (value.trim()) {
      sendTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(false);
      }, 2000);
    } else {
      sendTyping(false);
    }
  };

  const allMessages = [...messages, ...localMessages].sort((a, b) => a.ts - b.ts);
  const filteredTyping = typingUsers.filter((u) => u.id !== userId);

  return (
    <div ref={containerRef} className="flex flex-col flex-1 h-full overflow-hidden relative">
      {/* Shell pane (xterm.js) */}
      <div
        style={{
          height: isMobile ? '100%' : `${splitPercent}%`,
          background: '#1a1a1a',
          display: isMobile && mobileView !== 'terminal' ? 'none' : undefined,
        }}
        className="overflow-hidden"
      >
        <div ref={xtermContainerRef} className="w-full h-full" />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="flex-shrink-0 cursor-row-resize flex items-center justify-center"
        style={{
          height: 6,
          background: isDragging ? '#58a6ff' : '#333',
          display: isMobile ? 'none' : undefined,
        }}
      />

      {/* Chat pane */}
      <div
        style={{
          height: isMobile ? '100%' : `${100 - splitPercent}%`,
          background: '#1a1a1a',
          display: isMobile && mobileView !== 'chat' ? 'none' : undefined,
        }}
        className="flex flex-col overflow-hidden"
      >
        {/* Suggestions (claude-code mode) */}
        {mode === 'claude-code' && suggestions && suggestions.length > 0 && (
          <SuggestionPanel
            suggestions={suggestions}
            isDriver={myRole === 'driver'}
            onAccept={onAcceptSuggestion || (() => {})}
            onReject={onRejectSuggestion || (() => {})}
          />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-2 text-sm" style={{ fontFamily: 'inherit' }}>
          <div>
            {allMessages.map((msg, i) => (
              <div key={i} className="py-0.5" style={{ lineHeight: '1.5' }}>
                {msg.type === 'system' ? (
                  <span>
                    <span style={{ color: '#4a5060' }}>[system]</span>{' '}
                    <span style={{ color: '#6a737d', whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                  </span>
                ) : msg.type === 'cow' ? (
                  <div>
                    <span style={{ color: msg.color }}>[{msg.userName}]</span>
                    <pre
                      className="mt-1 text-xs"
                      style={{ color: '#d4d4d4', fontFamily: 'inherit', whiteSpace: 'pre' }}
                    >
                      {msg.text}
                    </pre>
                  </div>
                ) : (
                  <span>
                    <span style={{ color: msg.color }}>[{msg.userName}]</span>
                    <span style={{ color: '#555' }}> › </span>
                    <span style={{ color: '#d4d4d4' }}>{msg.text}</span>
                  </span>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Typing indicator */}
        {filteredTyping.length > 0 && (
          <div className="px-4 py-1 text-xs" style={{ color: '#6a737d' }}>
            <div>
            <span className="typing-dots">
              {filteredTyping.map((u) => (
                <span key={u.id} style={{ color: u.color }}>
                  {u.name}
                </span>
              )).reduce((prev: any, curr: any, i: number) => {
                if (i === 0) return [curr];
                return [...prev, ', ', curr];
              }, [])}
              {filteredTyping.length === 1 ? ' is typing...' : ' are typing...'}
            </span>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div
          style={{ borderTop: '1px solid #333', background: '#252526' }}
          className="px-4 py-2"
        >
          <div
            className="flex items-center"
          >
            <span className="mr-2 text-sm" style={{ color: '#6a737d' }}>
              ›
            </span>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => handleChatInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleChatSubmit();
              }}
              placeholder="chat or /command..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: '#d4d4d4', fontFamily: 'inherit' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
