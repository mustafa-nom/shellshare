'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserInfo, Message, TerminalTab, RoomState, Suggestion, Phase } from '../lib/types';
import { WS_URL } from '../lib/constants';

// sessionStorage helpers (per-tab, survives refresh but not new tabs)
function getSession(roomCode: string): { sessionToken: string; userId: string } | null {
  try {
    const raw = sessionStorage.getItem(`ss_session_${roomCode}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSession(roomCode: string, sessionToken: string, userId: string): void {
  try {
    sessionStorage.setItem(`ss_session_${roomCode}`, JSON.stringify({ sessionToken, userId }));
  } catch {}
}
function clearSessionStorage(roomCode: string): void {
  try {
    sessionStorage.removeItem(`ss_session_${roomCode}`);
  } catch {}
}

export type DriveChangeEvent =
  | { event: 'became_driver' }
  | { event: 'became_spectator' }
  | { event: 'driver_changed'; userName: string }
  | { event: 'driver_released'; userName: string }
  | { event: 'drive_requested'; userName: string };

interface UseWebSocketReturn {
  isConnected: boolean;
  userId: string | null;
  roomCode: string | null;
  users: UserInfo[];
  messages: Message[];
  terminals: TerminalTab[];
  isAdmin: boolean;
  myColor: string;
  locked: boolean;
  visibility: 'private' | 'open';
  typingUsers: { id: string; name: string; color: string }[];
  error: string | null;
  mode: 'normal' | 'claude-code';
  driverId: string | null;
  myRole: 'driver' | 'spectator' | null;
  suggestions: Suggestion[];
  phases: Phase[];
  sendChat: (text: string) => void;
  sendCommand: (text: string) => void;
  sendPtyInput: (terminalId: string, input: string) => void;
  sendTyping: (isTyping: boolean) => void;
  createTerminal: () => void;
  closeTerminal: (terminalId: string) => void;
  renameTerminal: (terminalId: string, label: string) => void;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => void;
  onPtyOutput: (handler: (terminalId: string, data: string) => void) => () => void;
  onMatrix: (handler: () => void) => void;
  onClear: (handler: () => void) => void;
  onDriveChange: (handler: (event: DriveChangeEvent) => void) => void;
  clearSession: () => void;
  requestDrive: () => void;
  releaseDrive: () => void;
  acceptSuggestion: (id: string) => void;
  rejectSuggestion: (id: string) => void;
  addPhase: (name: string) => void;
  updatePhase: (id: string, status: 'pending' | 'in-progress' | 'completed') => void;
  removePhase: (id: string) => void;
}

export function useWebSocket(roomCode: string, userName: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const ptyHandlersRef = useRef<Set<(terminalId: string, data: string) => void>>(new Set());
  const replayBufferRef = useRef<Map<string, string>>(new Map());
  const matrixHandlerRef = useRef<(() => void) | null>(null);
  const clearHandlerRef = useRef<(() => void) | null>(null);
  const driveChangeHandlerRef = useRef<((event: DriveChangeEvent) => void) | null>(null);
  const intentionalLeaveRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentRoomCode, setCurrentRoomCode] = useState<string | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myColor, setMyColor] = useState('#58a6ff');
  const [locked, setLocked] = useState(false);
  const [visibility, setVisibility] = useState<'private' | 'open'>('private');
  const [typingUsers, setTypingUsers] = useState<{ id: string; name: string; color: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'normal' | 'claude-code'>('normal');
  const [driverId, setDriverId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'driver' | 'spectator' | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);

  const connect = useCallback(() => {
    // Close any existing connection before opening a new one
    if (wsRef.current) {
      const oldWs = wsRef.current;
      wsRef.current = null; // Clear ref BEFORE closing to prevent onclose race
      oldWs.close();
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
      reconnectCountRef.current = 0;

      // Try to reconnect with existing session token (survives page refresh)
      const session = !intentionalLeaveRef.current ? getSession(roomCode) : null;
      if (session) {
        // Clear replay buffer before reconnect to avoid stale data
        replayBufferRef.current.clear();
        ws.send(JSON.stringify({ type: 'reconnect', roomCode, sessionToken: session.sessionToken }));
      } else {
        ws.send(JSON.stringify({ type: 'join', roomCode, userName }));
      }
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;

      // Binary frame = PTY output
      if (event.data instanceof ArrayBuffer) {
        const view = new Uint8Array(event.data);
        if (view[0] === 0x01 && view.length > 2) {
          const tidLen = view[1];
          const terminalId = new TextDecoder().decode(view.slice(2, 2 + tidLen));
          const data = new TextDecoder().decode(view.slice(2 + tidLen));
          ptyHandlersRef.current.forEach(handler => handler(terminalId, data));
        }
        return;
      }

      // JSON message
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'room_state': {
          const room: RoomState = msg.room;
          setCurrentRoomCode(room.code);
          setUserId(msg.userId);
          setUsers(room.users);
          setMessages(room.messages);
          setTerminals(room.terminals);
          setLocked(room.locked);
          setVisibility(room.visibility);

          // Claude-code mode state
          setMode(room.mode || 'normal');
          setDriverId(room.driverId || null);
          setSuggestions(room.suggestions || []);
          setPhases(room.phases || []);

          const me = room.users.find((u: UserInfo) => u.id === msg.userId);
          if (me) {
            setIsAdmin(me.isAdmin);
            setMyColor(me.color);
            setMyRole(me.role || null);
          }

          // Save session for reconnect on refresh
          if (msg.sessionToken) {
            saveSession(room.code, msg.sessionToken, msg.userId);
          }
          break;
        }
        case 'reconnect_failed': {
          // Clear stale session and fall back to fresh join
          clearSessionStorage(roomCode);
          ws.send(JSON.stringify({ type: 'join', roomCode, userName }));
          break;
        }
        case 'chat_message':
          setMessages((prev) => [...prev, msg.message]);
          break;
        case 'user_joined':
          setUsers((prev) => [...prev, msg.user]);
          break;
        case 'user_left':
          setUsers((prev) => prev.filter((u) => u.id !== msg.userId));
          if (msg.newAdminId) {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === msg.newAdminId ? { ...u, isAdmin: true } : u
              )
            );
            setUserId((currentId) => {
              if (currentId === msg.newAdminId) setIsAdmin(true);
              return currentId;
            });
          }
          break;
        case 'user_updated':
          setUsers((prev) =>
            prev.map((u) =>
              u.id === msg.userId ? { ...u, ...msg.changes } : u
            )
          );
          setUserId((currentId) => {
            if (currentId === msg.userId && msg.changes.isAdmin !== undefined) {
              setIsAdmin(msg.changes.isAdmin);
            }
            if (currentId === msg.userId && msg.changes.color) {
              setMyColor(msg.changes.color);
            }
            return currentId;
          });
          break;
        case 'typing_update':
          setTypingUsers(msg.users);
          break;
        case 'room_locked':
          setLocked(true);
          break;
        case 'room_unlocked':
          setLocked(false);
          break;
        case 'visibility_changed':
          setVisibility(msg.visibility);
          break;
        case 'terminal_created':
          setTerminals((prev) => [...prev, msg.terminal]);
          break;
        case 'terminal_closed':
          setTerminals((prev) => prev.filter((t) => t.id !== msg.terminalId));
          break;
        case 'terminal_renamed':
          setTerminals((prev) =>
            prev.map((t) => (t.id === msg.terminalId ? { ...t, label: msg.label } : t))
          );
          break;
        case 'pty_replay': {
          for (const buf of msg.buffers) {
            const bytes = Uint8Array.from(atob(buf.data), c => c.charCodeAt(0));
            const text = new TextDecoder().decode(bytes);
            replayBufferRef.current.set(buf.terminalId, text);
            ptyHandlersRef.current.forEach(handler => handler(buf.terminalId, text));
          }
          break;
        }
        case 'drive_granted': {
          setDriverId(msg.userId);
          setUsers(prev => prev.map(u =>
            u.id === msg.userId ? { ...u, role: 'driver' as const } : (u.role === 'driver' ? { ...u, role: 'spectator' as const } : u)
          ));
          setUserId(currentId => {
            if (currentId === msg.userId) {
              setMyRole('driver');
              driveChangeHandlerRef.current?.({ event: 'became_driver' });
            } else {
              const driverUser = users.find(u => u.id === msg.userId);
              driveChangeHandlerRef.current?.({ event: 'driver_changed', userName: driverUser?.name || 'Someone' });
            }
            return currentId;
          });
          break;
        }
        case 'drive_released': {
          setDriverId(null);
          setUsers(prev => prev.map(u =>
            u.id === msg.userId ? { ...u, role: 'spectator' as const } : u
          ));
          const releasedUser = users.find(u => u.id === msg.userId);
          setUserId(currentId => {
            if (currentId === msg.userId) {
              setMyRole('spectator');
              driveChangeHandlerRef.current?.({ event: 'became_spectator' });
            } else {
              driveChangeHandlerRef.current?.({ event: 'driver_released', userName: releasedUser?.name || 'Someone' });
            }
            return currentId;
          });
          break;
        }
        case 'role_changed':
          setUsers(prev => prev.map(u =>
            u.id === msg.userId ? { ...u, role: msg.role } : u
          ));
          setUserId(currentId => {
            if (currentId === msg.userId) {
              setMyRole(msg.role);
            }
            return currentId;
          });
          break;
        case 'drive_request': {
          driveChangeHandlerRef.current?.({ event: 'drive_requested', userName: msg.userName });
          break;
        }
        case 'suggestion_added':
          setSuggestions(prev => [...prev, msg.suggestion]);
          break;
        case 'suggestion_accepted':
          setSuggestions(prev => prev.filter(s => s.id !== msg.suggestionId));
          break;
        case 'suggestion_rejected':
          setSuggestions(prev => prev.filter(s => s.id !== msg.suggestionId));
          break;
        case 'phase_added':
          setPhases(prev => [...prev, msg.phase]);
          break;
        case 'phase_updated':
          setPhases(prev => prev.map(p => p.id === msg.phase.id ? msg.phase : p));
          break;
        case 'phase_removed':
          setPhases(prev => prev.filter(p => p.id !== msg.phaseId));
          break;
        case 'admin_clear':
          setMessages([]);
          clearHandlerRef.current?.();
          break;
        case 'matrix':
          matrixHandlerRef.current?.();
          break;
        case 'kicked':
          clearSessionStorage(roomCode);
          setError(msg.reason || 'You were kicked from the room.');
          ws.close();
          break;
        case 'error':
          setError(msg.message);
          // Clear error after 5s
          setTimeout(() => setError(null), 5000);
          break;
      }
    };

    ws.onclose = () => {
      // Only act if this ws is still the current one.
      // Prevents stale closures from nulling out a newer active WS
      // and triggering spurious reconnects.
      if (wsRef.current !== ws) return;

      setIsConnected(false);
      wsRef.current = null;

      // Auto-reconnect (max 3 attempts)
      if (reconnectCountRef.current < 3 && !error) {
        reconnectCountRef.current++;
        setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      // close will fire after this
    };
  }, [roomCode, userName, error]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendChat = useCallback((text: string) => send({ type: 'chat', text }), [send]);
  const sendCommand = useCallback((text: string) => send({ type: 'command', text }), [send]);
  const sendPtyInput = useCallback(
    (terminalId: string, input: string) => send({ type: 'pty_input', terminalId, input }),
    [send]
  );
  const sendTyping = useCallback((isTyping: boolean) => send({ type: 'typing', isTyping }), [send]);
  const createTerminal = useCallback(() => send({ type: 'new_terminal' }), [send]);
  const closeTerminal = useCallback((terminalId: string) => send({ type: 'close_terminal', terminalId }), [send]);
  const renameTerminal = useCallback(
    (terminalId: string, label: string) => send({ type: 'rename_terminal', terminalId, label }),
    [send]
  );
  const resizeTerminal = useCallback(
    (terminalId: string, cols: number, rows: number) => send({ type: 'resize', terminalId, cols, rows }),
    [send]
  );

  const onPtyOutput = useCallback((handler: (terminalId: string, data: string) => void) => {
    ptyHandlersRef.current.add(handler);
    // Replay buffered data for handlers that subscribe after pty_replay arrived
    for (const [terminalId, data] of replayBufferRef.current) {
      handler(terminalId, data);
    }
    return () => { ptyHandlersRef.current.delete(handler); };
  }, []);

  const onMatrix = useCallback((handler: () => void) => {
    matrixHandlerRef.current = handler;
  }, []);

  const onClear = useCallback((handler: () => void) => {
    clearHandlerRef.current = handler;
  }, []);

  const onDriveChange = useCallback((handler: (event: DriveChangeEvent) => void) => {
    driveChangeHandlerRef.current = handler;
  }, []);

  const requestDrive = useCallback(() => send({ type: 'drive_request' }), [send]);
  const releaseDrive = useCallback(() => send({ type: 'drive_release' }), [send]);
  const acceptSuggestion = useCallback((id: string) => send({ type: 'accept_suggestion', suggestionId: id }), [send]);
  const rejectSuggestion = useCallback((id: string) => send({ type: 'reject_suggestion', suggestionId: id }), [send]);
  const addPhase = useCallback((name: string) => send({ type: 'add_phase', name }), [send]);
  const updatePhase = useCallback((id: string, status: 'pending' | 'in-progress' | 'completed') => send({ type: 'update_phase', phaseId: id, status }), [send]);
  const removePhase = useCallback((id: string) => send({ type: 'remove_phase', phaseId: id }), [send]);

  const clearSession = useCallback(() => {
    intentionalLeaveRef.current = true;
    clearSessionStorage(roomCode);
  }, [roomCode]);

  return {
    isConnected,
    userId,
    roomCode: currentRoomCode,
    users,
    messages,
    terminals,
    isAdmin,
    myColor,
    locked,
    visibility,
    typingUsers,
    error,
    sendChat,
    sendCommand,
    sendPtyInput,
    sendTyping,
    createTerminal,
    closeTerminal,
    renameTerminal,
    resizeTerminal,
    onPtyOutput,
    onMatrix,
    onClear,
    onDriveChange,
    clearSession,
    mode,
    driverId,
    myRole,
    suggestions,
    phases,
    requestDrive,
    releaseDrive,
    acceptSuggestion,
    rejectSuggestion,
    addPhase,
    updatePhase,
    removePhase,
  };
}
