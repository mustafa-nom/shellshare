export interface UserInfo {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isAdmin: boolean;
  joinOrder: number;
  role?: 'driver' | 'spectator';
}

export interface Message {
  type: 'user' | 'system' | 'cow';
  userId?: string;
  userName?: string;
  color?: string;
  text: string;
  ts: number;
}

export interface TerminalTab {
  id: string;
  label: string;
}

export interface Suggestion {
  id: string;
  userId: string;
  userName: string;
  color: string;
  text: string;
  ts: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface Phase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed';
  createdAt: number;
  completedAt?: number;
}

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
  suggestions?: Suggestion[];
  phases?: Phase[];
}
