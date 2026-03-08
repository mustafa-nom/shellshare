import type { WebSocket } from 'ws';

// ─── Room ───
export interface Room {
  code: string;
  adminId: string;
  locked: boolean;
  visibility: 'private' | 'open';
  mode: 'normal' | 'claude-code';
  created: number;
  users: Map<string, User>;
  messageHistory: Message[];
  terminals: TerminalTab[];
  terminalCounter: number;
  driverId?: string; // Current driver in claude-code mode
  driveQueue: string[]; // Users requesting to drive
  suggestions: Suggestion[];
  phases: Phase[];
}

// ─── User ───
export interface User {
  id: string;
  name: string;
  color: string;
  colorName: string;
  joinOrder: number;
  isAdmin: boolean;
  ws: WebSocket;
  lastSeen: number;
  clientType?: 'browser' | 'cli';
  role?: 'driver' | 'spectator';
  sessionToken: string;
  disconnected?: boolean;
  disconnectTimer?: NodeJS.Timeout;
}

// ─── Message ───
export interface Message {
  type: 'user' | 'system' | 'cow';
  userId?: string;
  userName?: string;
  color?: string;
  text: string;
  ts: number;
}

// ─── Terminal Tab ───
export interface TerminalTab {
  id: string;
  label: string;
}

// ─── Suggestion ───
export interface Suggestion {
  id: string;
  userId: string;
  userName: string;
  color: string;
  text: string;
  ts: number;
  status: 'pending' | 'accepted' | 'rejected';
}

// ─── Phase ───
export interface Phase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed';
  createdAt: number;
  completedAt?: number;
}

// ─── User Info (sent to clients, no ws) ───
export interface UserInfo {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isAdmin: boolean;
  joinOrder: number;
  role?: 'driver' | 'spectator';
}

// ─── Room State (sent to new joiners) ───
export interface RoomState {
  code: string;
  locked: boolean;
  visibility: 'private' | 'open';
  mode: 'normal' | 'claude-code';
  users: UserInfo[];
  messages: Message[];
  terminals: TerminalTab[];
  adminId: string;
  driverId?: string;
  suggestions: Suggestion[];
  phases: Phase[];
  ptyDimensions?: Record<string, { cols: number; rows: number }>;
}

// ─── WebSocket Messages: Client -> Server ───
export type ClientMessage =
  | { type: 'join'; roomCode: string; userName: string; mode?: 'normal' | 'claude-code'; apiKey?: string; project?: string }
  | { type: 'chat'; text: string }
  | { type: 'command'; text: string }
  | { type: 'pty_input'; input: string; terminalId: string }
  | { type: 'typing'; isTyping: boolean }
  | { type: 'admin_kick'; targetUserId: string }
  | { type: 'admin_lock' }
  | { type: 'admin_unlock' }
  | { type: 'admin_clear' }
  | { type: 'set_visibility'; visibility: 'private' | 'open' }
  | { type: 'new_terminal' }
  | { type: 'close_terminal'; terminalId: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'rename_terminal'; terminalId: string; label: string }
  | { type: 'reconnect'; roomCode: string; sessionToken: string }
  | { type: 'roulette_request' }
  | { type: 'drive_request' }
  | { type: 'drive_release' }
  | { type: 'suggestion'; text: string }
  | { type: 'accept_suggestion'; suggestionId: string }
  | { type: 'reject_suggestion'; suggestionId: string }
  | { type: 'add_phase'; name: string }
  | { type: 'update_phase'; phaseId: string; status: 'pending' | 'in-progress' | 'completed' }
  | { type: 'remove_phase'; phaseId: string };

// ─── WebSocket Messages: Server -> Client ───
export type ServerMessage =
  | { type: 'room_state'; room: RoomState; userId: string; sessionToken?: string }
  | { type: 'reconnect_failed'; reason: string }
  | { type: 'chat_message'; message: Message }
  | { type: 'user_joined'; user: UserInfo }
  | { type: 'user_left'; userId: string; newAdminId?: string }
  | { type: 'user_updated'; userId: string; changes: Partial<UserInfo> }
  | { type: 'typing_update'; users: { id: string; name: string; color: string }[] }
  | { type: 'room_locked' }
  | { type: 'room_unlocked' }
  | { type: 'visibility_changed'; visibility: 'private' | 'open' }
  | { type: 'kicked'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'terminal_created'; terminal: TerminalTab }
  | { type: 'terminal_closed'; terminalId: string }
  | { type: 'terminal_renamed'; terminalId: string; label: string }
  | { type: 'admin_clear' }
  | { type: 'matrix' }
  | { type: 'roulette_match'; roomCode: string }
  | { type: 'roulette_no_match' }
  | { type: 'drive_request'; userId: string; userName: string }
  | { type: 'drive_granted'; userId: string }
  | { type: 'drive_released'; userId: string }
  | { type: 'suggestion'; userId: string; userName: string; text: string }
  | { type: 'role_changed'; userId: string; role: 'driver' | 'spectator' }
  | { type: 'pty_replay'; buffers: { terminalId: string; data: string }[] }
  | { type: 'suggestion_added'; suggestion: Suggestion }
  | { type: 'suggestion_accepted'; suggestionId: string; text: string; driverName: string; suggesterId: string }
  | { type: 'suggestion_rejected'; suggestionId: string; suggesterId: string; reason?: string }
  | { type: 'phase_added'; phase: Phase }
  | { type: 'phase_updated'; phase: Phase }
  | { type: 'phase_removed'; phaseId: string }
  | { type: 'pty_dimensions'; terminalId: string; cols: number; rows: number };
