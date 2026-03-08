'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, UserInfo, Suggestion } from '../lib/types';
import { XTERM_THEME } from '../lib/constants';
import SuggestionPanel from './SuggestionPanel';

const DEFAULT_PTY_DIMS = { cols: 120, rows: 40 };

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
  ptyDimensions?: { cols: number; rows: number };
  isVisibleTab?: boolean;
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
  ptyDimensions,
  isVisibleTab,
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

  // Spectator scaling state
  const [isScrollMode, setIsScrollMode] = useState(false);
  const [currentScale, setCurrentScale] = useState(1.0);
  const [isPortrait, setIsPortrait] = useState(true);
  const [showScaleIndicator, setShowScaleIndicator] = useState(false);
  const scaleIndicatorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const spectatorObserverRef = useRef<ResizeObserver | null>(null);
  const prevVisibleRef = useRef(isVisibleTab);

  const isSpectatorInClaudeCode = mode === 'claude-code' && myRole === 'spectator';
  const isDriverOrNormal = myRole === 'driver' || mode !== 'claude-code';

  // Helper: should we use FitAddon?
  const canFit = useCallback(() => {
    return myRole === 'driver' || mode !== 'claude-code';
  }, [myRole, mode]);

  // Apply CSS scaling for spectators
  const applySpectatorScaling = useCallback(() => {
    const container = xtermContainerRef.current;
    const xtermScreen = container?.querySelector('.xterm-screen') as HTMLElement;
    if (!container || !xtermScreen) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const xtermWidth = xtermScreen.scrollWidth;
    const xtermHeight = xtermScreen.scrollHeight;

    if (xtermWidth === 0 || xtermHeight === 0) return;

    const scaleX = containerWidth / xtermWidth;
    const scaleY = containerHeight / xtermHeight;
    let scale = Math.min(scaleX, scaleY, 1.0);

    const MIN_SCALE = isMobile ? 0.2 : 0.35;

    if (scale < MIN_SCALE) {
      // Switch to scroll mode
      xtermScreen.style.transform = '';
      xtermScreen.style.transformOrigin = '';
      xtermScreen.style.marginLeft = '';
      xtermScreen.style.marginTop = '';
      container.style.overflow = 'auto';
      (container.style as any).WebkitOverflowScrolling = 'touch';
      setIsScrollMode(true);
      setCurrentScale(scale);
      return;
    }

    setIsScrollMode(false);
    container.style.overflow = 'hidden';
    xtermScreen.style.transform = `scale(${scale})`;
    xtermScreen.style.transformOrigin = 'top left';

    const scaledWidth = xtermWidth * scale;
    const scaledHeight = xtermHeight * scale;
    const offsetX = Math.max(0, (containerWidth - scaledWidth) / 2);
    const offsetY = Math.max(0, (containerHeight - scaledHeight) / 2);
    xtermScreen.style.marginLeft = `${offsetX}px`;
    xtermScreen.style.marginTop = `${offsetY}px`;

    setCurrentScale(scale);
  }, [isMobile]);

  // Clear spectator CSS
  const clearSpectatorCSS = useCallback(() => {
    const container = xtermContainerRef.current;
    const xtermScreen = container?.querySelector('.xterm-screen') as HTMLElement;
    if (xtermScreen) {
      xtermScreen.style.transform = '';
      xtermScreen.style.transformOrigin = '';
      xtermScreen.style.marginLeft = '';
      xtermScreen.style.marginTop = '';
    }
    if (container) {
      container.style.overflow = '';
      (container.style as any).WebkitOverflowScrolling = '';
    }
    setIsScrollMode(false);
    setCurrentScale(1.0);
  }, []);

  // Portrait detection for mobile
  useEffect(() => {
    if (!isMobile) return;
    const mq = window.matchMedia('(orientation: portrait)');
    setIsPortrait(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [isMobile]);

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

      const isSpectator = mode === 'claude-code' && myRole === 'spectator';

      terminal = new Terminal({
        theme: XTERM_THEME,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
        fontSize: isSpectator ? 13 : (isMobile ? 14 : 13),
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 10000,
        disableStdin: isSpectator && isMobile,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      if (xtermContainerRef.current) {
        terminal.open(xtermContainerRef.current);

        if (isSpectator) {
          // Lock to PTY dimensions, don't fit
          const dims = ptyDimensions || DEFAULT_PTY_DIMS;
          terminal.resize(dims.cols, dims.rows);

          // Hide textarea on mobile to prevent keyboard popup
          if (isMobile) {
            const textarea = xtermContainerRef.current.querySelector('textarea');
            if (textarea) textarea.style.display = 'none';
          }
        } else {
          fitAddon.fit();
        }
        terminal.focus();
      }

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Send keystrokes to PTY
      terminal.onData((data: string) => {
        sendPtyInput(terminalId, data);
      });

      // Report initial size (only if driver/normal)
      if (!isSpectator) {
        resizeTerminal(terminalId, terminal.cols, terminal.rows);
      }

      // Apply spectator scaling after a frame
      if (isSpectator) {
        requestAnimationFrame(() => applySpectatorScaling());
      }
    };

    init();

    return () => {
      disposed = true;
      if (terminal) terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId, resizeTerminal, sendPtyInput]);

  // Handle role switch (driver <-> spectator)
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal || !fitAddonRef.current) return;

    if (isDriverOrNormal) {
      // Switched to driver or normal mode
      clearSpectatorCSS();

      // Disconnect spectator observer
      if (spectatorObserverRef.current) {
        spectatorObserverRef.current.disconnect();
        spectatorObserverRef.current = null;
      }

      // Restore font size
      terminal.options.fontSize = isMobile ? 14 : 13;
      terminal.options.disableStdin = false;

      // Show textarea again
      if (isMobile && xtermContainerRef.current) {
        const textarea = xtermContainerRef.current.querySelector('textarea');
        if (textarea) (textarea as HTMLElement).style.display = '';
      }

      // Re-enable FitAddon
      fitAddonRef.current.fit();
      resizeTerminal(terminalId, terminal.cols, terminal.rows);
    } else if (isSpectatorInClaudeCode) {
      // Switched to spectator
      terminal.options.fontSize = 13;

      if (isMobile) {
        terminal.options.disableStdin = true;
        if (xtermContainerRef.current) {
          const textarea = xtermContainerRef.current.querySelector('textarea');
          if (textarea) (textarea as HTMLElement).style.display = 'none';
        }
      }

      // Lock to PTY dimensions
      const dims = ptyDimensions || DEFAULT_PTY_DIMS;
      terminal.resize(dims.cols, dims.rows);

      requestAnimationFrame(() => applySpectatorScaling());
    }
  }, [isDriverOrNormal, isSpectatorInClaudeCode]);

  // When ptyDimensions change, update spectator terminal
  useEffect(() => {
    if (!isSpectatorInClaudeCode || !xtermRef.current || !ptyDimensions) return;

    xtermRef.current.resize(ptyDimensions.cols, ptyDimensions.rows);
    requestAnimationFrame(() => applySpectatorScaling());
  }, [ptyDimensions?.cols, ptyDimensions?.rows, isSpectatorInClaudeCode, applySpectatorScaling]);

  // Spectator ResizeObserver (watch container for scaling recalculation)
  useEffect(() => {
    if (!isSpectatorInClaudeCode) {
      if (spectatorObserverRef.current) {
        spectatorObserverRef.current.disconnect();
        spectatorObserverRef.current = null;
      }
      return;
    }

    const observer = new ResizeObserver(() => {
      applySpectatorScaling();
    });

    if (xtermContainerRef.current) {
      observer.observe(xtermContainerRef.current);
    }
    spectatorObserverRef.current = observer;

    return () => {
      observer.disconnect();
      spectatorObserverRef.current = null;
    };
  }, [isSpectatorInClaudeCode, applySpectatorScaling]);

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
    if (isActive && xtermRef.current) {
      requestAnimationFrame(() => {
        if (canFit()) {
          fitAddonRef.current?.fit();
          if (xtermRef.current) {
            resizeTerminal(terminalId, xtermRef.current.cols, xtermRef.current.rows);
          }
        } else if (isSpectatorInClaudeCode) {
          applySpectatorScaling();
        }
        xtermRef.current?.focus();
      });
    }
  }, [isActive, terminalId, resizeTerminal, canFit, isSpectatorInClaudeCode, applySpectatorScaling]);

  // Mobile tab switch recalculation
  useEffect(() => {
    const wasHidden = !prevVisibleRef.current;
    prevVisibleRef.current = isVisibleTab;
    if (!isVisibleTab || !wasHidden) return;

    const timer = setTimeout(() => {
      if (canFit()) {
        fitAddonRef.current?.fit();
        if (xtermRef.current) {
          resizeTerminal(terminalId, xtermRef.current.cols, xtermRef.current.rows);
        }
      } else {
        applySpectatorScaling();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isVisibleTab, canFit, applySpectatorScaling, resizeTerminal, terminalId]);

  // Driver ResizeObserver (container change -> refit)
  useEffect(() => {
    if (!isDriverOrNormal) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current && canFit()) {
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
  }, [isDriverOrNormal, resizeTerminal, canFit, terminalId]);

  // Scale indicator show/hide
  useEffect(() => {
    if (!isSpectatorInClaudeCode || currentScale >= 1.0) {
      setShowScaleIndicator(false);
      return;
    }
    setShowScaleIndicator(true);
    if (scaleIndicatorTimerRef.current) clearTimeout(scaleIndicatorTimerRef.current);
    scaleIndicatorTimerRef.current = setTimeout(() => setShowScaleIndicator(false), 5000);
    return () => {
      if (scaleIndicatorTimerRef.current) clearTimeout(scaleIndicatorTimerRef.current);
    };
  }, [currentScale, isSpectatorInClaudeCode]);

  // Mobile spectator touch handling: block horizontal scroll in scale mode
  useEffect(() => {
    if (!isSpectatorInClaudeCode || !isMobile || isScrollMode) return;

    const container = xtermContainerRef.current;
    if (!container) return;

    const handler = (e: TouchEvent) => {
      // Allow vertical scroll (terminal history), block horizontal (page pan)
      if (e.touches.length === 1) {
        // In scale mode we block default to prevent page navigation
        e.preventDefault();
      }
    };

    container.addEventListener('touchmove', handler, { passive: false });
    return () => container.removeEventListener('touchmove', handler);
  }, [isSpectatorInClaudeCode, isMobile, isScrollMode]);

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
      if (canFit() && fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      if (canFit() && fitAddonRef.current) {
        fitAddonRef.current.fit();
      } else if (isSpectatorInClaudeCode) {
        applySpectatorScaling();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.touches[0].clientY - rect.top) / rect.height) * 100;
      setSplitPercent(Math.min(85, Math.max(20, percent)));
      if (canFit() && fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      if (canFit() && fitAddonRef.current) {
        fitAddonRef.current.fit();
      } else if (isSpectatorInClaudeCode) {
        applySpectatorScaling();
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
  }, [isDragging, canFit, isSpectatorInClaudeCode, applySpectatorScaling]);

  // Handle chat input
  const handleChatSubmit = () => {
    const text = chatInput.trim();
    if (!text) return;

    if (text.startsWith('/')) {
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

  // Scale indicator text
  const scalePercent = Math.round(currentScale * 100);
  const dims = ptyDimensions || DEFAULT_PTY_DIMS;
  const showLandscapeHint = isMobile && currentScale < 0.5 && isPortrait;

  return (
    <div ref={containerRef} className="flex flex-col flex-1 h-full overflow-hidden relative">
      {/* Shell pane (xterm.js) */}
      <div
        style={{
          height: isMobile ? '100%' : `${splitPercent}%`,
          background: '#1a1a1a',
          display: isMobile && mobileView !== 'terminal' ? 'none' : undefined,
          position: 'relative',
        }}
        className="overflow-hidden"
      >
        <div ref={xtermContainerRef} className="w-full h-full" />

        {/* Scale indicator */}
        {isSpectatorInClaudeCode && showScaleIndicator && currentScale < 1.0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.75)',
              color: '#8b949e',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 11,
              whiteSpace: 'nowrap',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {showLandscapeHint
              ? `${scalePercent}% · Rotate for a better view`
              : `Viewing at ${scalePercent}% — driver's terminal is ${dims.cols}x${dims.rows}`
            }
          </div>
        )}
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
