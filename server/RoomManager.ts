import type { WebSocket } from 'ws';
import type { Room, User, Message, UserInfo, RoomState, ServerMessage, TerminalTab, Suggestion, Phase } from './types';
import { genId, genRoomCode, genSessionToken, getNextColor, userToInfo } from './utils';
import { PtyManager } from './PtyManager';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private userRoomMap: Map<string, string> = new Map(); // userId -> roomCode
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private typingState: Map<string, Map<string, NodeJS.Timeout>> = new Map(); // roomCode -> userId -> timeout
  private sessionTokenMap: Map<string, { userId: string; roomCode: string }> = new Map(); // sessionToken -> userId + roomCode
  public ptyManager: PtyManager;

  constructor() {
    this.ptyManager = new PtyManager();
  }

  createRoom(ws: WebSocket, userName: string, visibility: 'private' | 'open' = 'private', mode: 'normal' | 'claude-code' = 'normal'): { room: Room; user: User } {
    const code = genRoomCode();
    const userId = genId();
    const color = getNextColor(new Set());

    const sessionToken = genSessionToken();
    const user: User = {
      id: userId,
      name: userName,
      color: color.hex,
      colorName: color.name,
      joinOrder: 1,
      isAdmin: true,
      ws,
      lastSeen: Date.now(),
      role: mode === 'claude-code' ? 'driver' : undefined,
      sessionToken,
    };

    const terminalId = genId();
    const room: Room = {
      code,
      adminId: userId,
      locked: false,
      visibility,
      mode,
      created: Date.now(),
      users: new Map([[userId, user]]),
      messageHistory: [],
      terminals: [{ id: terminalId, label: mode === 'claude-code' ? 'Claude Code' : 'Terminal 1' }],
      terminalCounter: 1,
      driverId: mode === 'claude-code' ? userId : undefined,
      driveQueue: [],
      suggestions: [],
      phases: [],
    };

    this.rooms.set(code, room);
    this.userRoomMap.set(userId, code);
    this.sessionTokenMap.set(sessionToken, { userId, roomCode: code });

    // PTY is spawned lazily on first resize from client

    // Add system message
    const modeLabel = mode === 'claude-code' ? ' (Claude Code mode)' : '';
    const joinMsg: Message = {
      type: 'system',
      text: `${userName} has joined. Room created${modeLabel}.`,
      ts: Date.now(),
    };
    room.messageHistory.push(joinMsg);

    return { room, user };
  }

  joinRoom(code: string, ws: WebSocket, userName: string): { room: Room; user: User } | { error: string } {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.locked) return { error: 'Room is locked' };

    // Cancel cleanup timer if pending
    const timer = this.cleanupTimers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(code);
    }

    const takenColors = new Set<string>();
    for (const u of room.users.values()) {
      takenColors.add(u.colorName);
    }

    const maxOrder = Math.max(0, ...Array.from(room.users.values()).map((u) => u.joinOrder));
    const color = getNextColor(takenColors);
    const userId = genId();
    const sessionToken = genSessionToken();

    const user: User = {
      id: userId,
      name: userName,
      color: color.hex,
      colorName: color.name,
      joinOrder: maxOrder + 1,
      isAdmin: false,
      ws,
      lastSeen: Date.now(),
      role: room.mode === 'claude-code' ? 'spectator' : undefined,
      sessionToken,
    };

    room.users.set(userId, user);
    this.userRoomMap.set(userId, code);
    this.sessionTokenMap.set(sessionToken, { userId, roomCode: code });

    // System message
    const joinMsg: Message = {
      type: 'system',
      text: `${userName} has joined.`,
      ts: Date.now(),
    };
    room.messageHistory.push(joinMsg);
    this.pruneMessages(room);

    // Broadcast join to others
    this.broadcastToOthers(room, userId, {
      type: 'user_joined',
      user: userToInfo(user),
    });
    this.broadcastToOthers(room, userId, {
      type: 'chat_message',
      message: joinMsg,
    });

    return { room, user };
  }

  leaveRoom(userId: string): void {
    const code = this.userRoomMap.get(userId);
    if (!code) return;

    const room = this.rooms.get(code);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    // Clean up session token and disconnect timer
    this.sessionTokenMap.delete(user.sessionToken);
    if (user.disconnectTimer) {
      clearTimeout(user.disconnectTimer);
      user.disconnectTimer = undefined;
    }

    room.users.delete(userId);
    this.userRoomMap.delete(userId);

    // Clear typing state
    this.clearTyping(code, userId);

    // Handle driver disconnect in claude-code mode
    if (room.mode === 'claude-code') {
      if (room.driverId === userId) {
        room.driverId = undefined;
        // Grant to next in queue, or admin, or first remaining user
        const nextId = room.driveQueue.shift();
        if (nextId && room.users.has(nextId)) {
          this.grantDrive(room, nextId);
        } else if (room.users.size > 0) {
          const admin = room.users.get(room.adminId);
          const fallback = admin || Array.from(room.users.values())[0];
          this.grantDrive(room, fallback.id);
        }
      }
      // Remove from drive queue if present
      room.driveQueue = room.driveQueue.filter(id => id !== userId);
      // Remove their pending suggestions
      room.suggestions = room.suggestions.filter(s => s.userId !== userId);
    }

    const leaveMsg: Message = {
      type: 'system',
      text: `${user.name} has left.`,
      ts: Date.now(),
    };
    room.messageHistory.push(leaveMsg);
    this.pruneMessages(room);

    let newAdminId: string | undefined;

    // Admin transfer
    if (user.isAdmin && room.users.size > 0) {
      const nextAdmin = Array.from(room.users.values()).sort((a, b) => a.joinOrder - b.joinOrder)[0];
      nextAdmin.isAdmin = true;
      room.adminId = nextAdmin.id;
      newAdminId = nextAdmin.id;

      const transferMsg: Message = {
        type: 'system',
        text: `${nextAdmin.name} is now the room admin.`,
        ts: Date.now(),
      };
      room.messageHistory.push(transferMsg);

      this.broadcast(room, { type: 'chat_message', message: transferMsg });
      this.broadcast(room, {
        type: 'user_updated',
        userId: nextAdmin.id,
        changes: { isAdmin: true },
      });
    }

    this.broadcast(room, { type: 'user_left', userId, newAdminId });
    this.broadcast(room, { type: 'chat_message', message: leaveMsg });

    // If empty, start cleanup timer
    if (room.users.size === 0) {
      const timer = setTimeout(() => {
        this.destroyRoom(code);
      }, 60000);
      this.cleanupTimers.set(code, timer);
    }
  }

  disconnectUser(userId: string): void {
    const code = this.userRoomMap.get(userId);
    if (!code) return;

    const room = this.rooms.get(code);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    user.disconnected = true;

    // Clear typing state
    this.clearTyping(code, userId);

    // Start 30s grace period — if they don't reconnect, fully leave
    user.disconnectTimer = setTimeout(() => {
      user.disconnectTimer = undefined;
      this.leaveRoom(userId);
    }, 30000);
  }

  reconnectUser(sessionToken: string, newWs: WebSocket): { room: Room; user: User } | { error: string } {
    const entry = this.sessionTokenMap.get(sessionToken);
    if (!entry) return { error: 'Session expired' };

    const { userId, roomCode } = entry;
    const room = this.rooms.get(roomCode);
    if (!room) return { error: 'Session expired' };

    const user = room.users.get(userId);
    if (!user) return { error: 'Session expired' };

    // If user isn't marked disconnected yet, check if old WS is actually dead (race on refresh)
    if (!user.disconnected) {
      if (user.ws.readyState === 0 /* CONNECTING */ || user.ws.readyState === 1 /* OPEN */) {
        return { error: 'Session already active' };
      }
      // Old WS is CLOSING or CLOSED — treat as disconnected (race condition on refresh)
    }

    // Cancel disconnect timer
    if (user.disconnectTimer) {
      clearTimeout(user.disconnectTimer);
      user.disconnectTimer = undefined;
    }

    // Cancel room cleanup timer if set
    const cleanupTimer = this.cleanupTimers.get(roomCode);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(roomCode);
    }

    user.ws = newWs;
    user.disconnected = false;
    user.lastSeen = Date.now();

    return { room, user };
  }

  getRoomState(room: Room): RoomState {
    return {
      code: room.code,
      locked: room.locked,
      visibility: room.visibility,
      mode: room.mode,
      users: Array.from(room.users.values()).map(userToInfo),
      messages: room.messageHistory.slice(-100),
      terminals: room.terminals,
      adminId: room.adminId,
      driverId: room.driverId,
      suggestions: room.suggestions.filter(s => s.status === 'pending'),
      phases: room.phases,
    };
  }

  addMessage(room: Room, message: Message): void {
    room.messageHistory.push(message);
    this.pruneMessages(room);
    this.broadcast(room, { type: 'chat_message', message });
  }

  kickUser(roomCode: string, adminId: string, targetUserId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.adminId !== adminId) return false;

    const target = room.users.get(targetUserId);
    if (!target || target.isAdmin) return false;

    // Clean up session token and disconnect timer
    this.sessionTokenMap.delete(target.sessionToken);
    if (target.disconnectTimer) {
      clearTimeout(target.disconnectTimer);
      target.disconnectTimer = undefined;
    }

    // Send kicked message to target
    this.sendTo(target.ws, { type: 'kicked', reason: 'You were kicked by the admin.' });
    target.ws.close();

    const kickMsg: Message = {
      type: 'system',
      text: `${target.name} was kicked by the admin.`,
      ts: Date.now(),
    };

    room.users.delete(targetUserId);
    this.userRoomMap.delete(targetUserId);

    room.messageHistory.push(kickMsg);
    this.pruneMessages(room);
    this.broadcast(room, { type: 'user_left', userId: targetUserId });
    this.broadcast(room, { type: 'chat_message', message: kickMsg });

    return true;
  }

  lockRoom(roomCode: string, adminId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.adminId !== adminId) return false;
    room.locked = true;

    const msg: Message = { type: 'system', text: 'Room is now locked.', ts: Date.now() };
    room.messageHistory.push(msg);
    this.broadcast(room, { type: 'room_locked' });
    this.broadcast(room, { type: 'chat_message', message: msg });
    return true;
  }

  unlockRoom(roomCode: string, adminId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.adminId !== adminId) return false;
    room.locked = false;

    const msg: Message = { type: 'system', text: 'Room is now unlocked.', ts: Date.now() };
    room.messageHistory.push(msg);
    this.broadcast(room, { type: 'room_unlocked' });
    this.broadcast(room, { type: 'chat_message', message: msg });
    return true;
  }

  setVisibility(roomCode: string, adminId: string, visibility: 'private' | 'open'): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.adminId !== adminId) return false;
    room.visibility = visibility;

    const text =
      visibility === 'open'
        ? 'Room is now public. It may appear in Shell Roulette.'
        : 'Room is now private.';
    const msg: Message = { type: 'system', text, ts: Date.now() };
    room.messageHistory.push(msg);
    this.broadcast(room, { type: 'visibility_changed', visibility });
    this.broadcast(room, { type: 'chat_message', message: msg });
    return true;
  }

  clearMessages(roomCode: string, adminId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.adminId !== adminId) return false;
    room.messageHistory = [];
    this.broadcast(room, { type: 'admin_clear' });
    return true;
  }

  createTerminal(roomCode: string): TerminalTab | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const terminalId = genId();
    room.terminalCounter++;
    const label = `Terminal ${room.terminalCounter}`;
    const tab: TerminalTab = { id: terminalId, label };

    room.terminals.push(tab);
    // PTY is spawned lazily on first resize from client
    this.broadcast(room, { type: 'terminal_created', terminal: tab });

    return tab;
  }

  renameTerminal(roomCode: string, terminalId: string, label: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const tab = room.terminals.find((t) => t.id === terminalId);
    if (!tab) return false;

    tab.label = label.slice(0, 15);
    this.broadcast(room, { type: 'terminal_renamed', terminalId, label: tab.label });
    return true;
  }

  closeTerminal(roomCode: string, terminalId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    if (room.terminals.length <= 1) return false;

    const idx = room.terminals.findIndex((t) => t.id === terminalId);
    if (idx === -1) return false;

    room.terminals.splice(idx, 1);
    this.ptyManager.killPty(roomCode, terminalId);
    this.broadcast(room, { type: 'terminal_closed', terminalId });

    return true;
  }

  // ─── Claude Code Mode: Driver/Spectator Management ───

  requestDrive(roomCode: string, userId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;

    const user = room.users.get(userId);
    if (!user) return;

    // If no current driver, grant immediately
    if (!room.driverId) {
      this.grantDrive(room, userId);
      return;
    }

    // Add to queue and notify current driver
    if (!room.driveQueue.includes(userId)) {
      room.driveQueue.push(userId);
    }

    const driver = room.users.get(room.driverId);
    if (driver) {
      this.sendTo(driver.ws, { type: 'drive_request', userId, userName: user.name });
    }

    const msg: Message = { type: 'system', text: `${user.name} requested to drive.`, ts: Date.now() };
    this.addMessage(room, msg);
  }

  releaseDrive(roomCode: string, userId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const user = room.users.get(userId);
    user!.role = 'spectator';
    this.broadcast(room, { type: 'role_changed', userId, role: 'spectator' });
    this.broadcast(room, { type: 'drive_released', userId });

    room.driverId = undefined;

    // Grant to next in queue
    if (room.driveQueue.length > 0) {
      const nextId = room.driveQueue.shift()!;
      this.grantDrive(room, nextId);
    }

    const msg: Message = { type: 'system', text: `${user!.name} released control.`, ts: Date.now() };
    this.addMessage(room, msg);
  }

  sendSuggestion(roomCode: string, userId: string, text: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;

    const user = room.users.get(userId);
    if (!user) return;

    // Spectators only (not driver)
    if (room.driverId === userId) return;

    // Max 3 pending per user
    const userPending = room.suggestions.filter(s => s.userId === userId && s.status === 'pending');
    if (userPending.length >= 3) return;

    // Validate length
    if (text.length < 1 || text.length > 500) return;

    const suggestion: Suggestion = {
      id: genId(),
      userId,
      userName: user.name,
      color: user.color,
      text,
      ts: Date.now(),
      status: 'pending',
    };

    room.suggestions.push(suggestion);
    this.broadcast(room, { type: 'suggestion_added', suggestion });

    const msg: Message = { type: 'system', text: `${user.name} suggested: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`, ts: Date.now() };
    this.addMessage(room, msg);
  }

  acceptSuggestionById(roomCode: string, userId: string, suggestionId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const idx = room.suggestions.findIndex(s => s.id === suggestionId && s.status === 'pending');
    if (idx === -1) return;

    const suggestion = room.suggestions[idx];
    suggestion.status = 'accepted';

    const driver = room.users.get(userId);
    const driverName = driver?.name || 'Driver';

    // Write to PTY
    if (room.terminals.length > 0) {
      this.ptyManager.writeToPty(roomCode, room.terminals[0].id, suggestion.text);
    }

    this.broadcast(room, {
      type: 'suggestion_accepted',
      suggestionId,
      text: suggestion.text,
      driverName,
      suggesterId: suggestion.userId,
    });

    // Remove from list
    room.suggestions.splice(idx, 1);

    const msg: Message = { type: 'system', text: `${driverName} accepted ${suggestion.userName}'s suggestion.`, ts: Date.now() };
    this.addMessage(room, msg);
  }

  rejectSuggestionById(roomCode: string, userId: string, suggestionId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const idx = room.suggestions.findIndex(s => s.id === suggestionId && s.status === 'pending');
    if (idx === -1) return;

    const suggestion = room.suggestions[idx];
    suggestion.status = 'rejected';

    const driver = room.users.get(userId);
    const driverName = driver?.name || 'Driver';

    this.broadcast(room, {
      type: 'suggestion_rejected',
      suggestionId,
      suggesterId: suggestion.userId,
    });

    // Send system message to suggester
    const suggester = room.users.get(suggestion.userId);
    if (suggester) {
      this.sendTo(suggester.ws, {
        type: 'chat_message',
        message: { type: 'system', text: `Your suggestion was rejected by ${driverName}.`, ts: Date.now() },
      });
    }

    room.suggestions.splice(idx, 1);

    const msg: Message = { type: 'system', text: `${driverName} rejected ${suggestion.userName}'s suggestion.`, ts: Date.now() };
    this.addMessage(room, msg);
  }

  acceptSuggestionByIndex(roomCode: string, userId: string, index?: number): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const pending = room.suggestions.filter(s => s.status === 'pending');
    if (pending.length === 0) return;

    const target = index !== undefined ? pending[index - 1] : pending[0];
    if (!target) return;

    this.acceptSuggestionById(roomCode, userId, target.id);
  }

  rejectSuggestionByIndex(roomCode: string, userId: string, index?: number): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const pending = room.suggestions.filter(s => s.status === 'pending');
    if (pending.length === 0) return;

    const target = index !== undefined ? pending[index - 1] : pending[0];
    if (!target) return;

    this.rejectSuggestionById(roomCode, userId, target.id);
  }

  // ─── Phase Management ───

  addPhase(roomCode: string, userId: string, name: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;
    if (room.phases.length >= 20) return;
    if (!name || name.length > 100) return;

    const phase: Phase = {
      id: genId(),
      name,
      status: 'pending',
      createdAt: Date.now(),
    };

    room.phases.push(phase);
    this.broadcast(room, { type: 'phase_added', phase });
  }

  updatePhase(roomCode: string, userId: string, phaseId: string, status: 'pending' | 'in-progress' | 'completed'): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const phase = room.phases.find(p => p.id === phaseId);
    if (!phase) return;

    phase.status = status;
    if (status === 'completed') {
      phase.completedAt = Date.now();
    } else {
      phase.completedAt = undefined;
    }

    this.broadcast(room, { type: 'phase_updated', phase });
  }

  removePhase(roomCode: string, userId: string, phaseId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return;
    if (room.driverId !== userId) return;

    const idx = room.phases.findIndex(p => p.id === phaseId);
    if (idx === -1) return;

    room.phases.splice(idx, 1);
    this.broadcast(room, { type: 'phase_removed', phaseId });
  }

  // Find phase by name or 1-based index
  findPhase(room: Room, nameOrIndex: string): Phase | undefined {
    const idx = parseInt(nameOrIndex, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= room.phases.length) {
      return room.phases[idx - 1];
    }
    return room.phases.find(p => p.name.toLowerCase() === nameOrIndex.toLowerCase());
  }

  // Suggestion expiry cleanup (call from interval)
  cleanupExpiredSuggestions(): void {
    const now = Date.now();
    const EXPIRY = 5 * 60 * 1000; // 5 minutes

    for (const room of this.rooms.values()) {
      const expired = room.suggestions.filter(s => s.status === 'pending' && now - s.ts > EXPIRY);
      for (const s of expired) {
        s.status = 'rejected';
        this.broadcast(room, {
          type: 'suggestion_rejected',
          suggestionId: s.id,
          suggesterId: s.userId,
          reason: 'expired',
        });
      }
      room.suggestions = room.suggestions.filter(s => s.status === 'pending');
    }
  }

  private grantDrive(room: Room, userId: string): void {
    const user = room.users.get(userId);
    if (!user) return;

    room.driverId = userId;
    user.role = 'driver';

    this.broadcast(room, { type: 'drive_granted', userId });
    this.broadcast(room, { type: 'role_changed', userId, role: 'driver' });

    const msg: Message = { type: 'system', text: `${user.name} is now driving.`, ts: Date.now() };
    this.addMessage(room, msg);
  }

  isDriver(roomCode: string, userId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.mode !== 'claude-code') return true; // Normal mode: everyone can type
    return room.driverId === userId;
  }

  getTerminalBuffers(roomCode: string): { terminalId: string; data: string }[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];

    const buffers: { terminalId: string; data: string }[] = [];
    for (const terminal of room.terminals) {
      const buf = this.ptyManager.getOutputBuffer(roomCode, terminal.id);
      if (buf.length > 0) {
        buffers.push({ terminalId: terminal.id, data: buf.toString('base64') });
      }
    }
    return buffers;
  }

  getRandomOpenRoom(): Room | null {
    const openRooms = Array.from(this.rooms.values()).filter(
      (r) => r.visibility === 'open' && !r.locked && r.users.size > 0
    );
    if (openRooms.length === 0) return null;

    // Weight toward fewer users
    openRooms.sort((a, b) => a.users.size - b.users.size);
    // Pick from the bottom half
    const idx = Math.floor(Math.random() * Math.min(3, openRooms.length));
    return openRooms[idx];
  }

  setTyping(roomCode: string, userId: string): void {
    if (!this.typingState.has(roomCode)) {
      this.typingState.set(roomCode, new Map());
    }
    const roomTyping = this.typingState.get(roomCode)!;

    // Clear existing timeout
    const existing = roomTyping.get(userId);
    if (existing) clearTimeout(existing);

    // Set new timeout to auto-clear after 3s
    const timeout = setTimeout(() => {
      this.clearTyping(roomCode, userId);
      this.broadcastTyping(roomCode);
    }, 3000);
    roomTyping.set(userId, timeout);

    this.broadcastTyping(roomCode);
  }

  clearTyping(roomCode: string, userId: string): void {
    const roomTyping = this.typingState.get(roomCode);
    if (!roomTyping) return;
    const existing = roomTyping.get(userId);
    if (existing) clearTimeout(existing);
    roomTyping.delete(userId);
  }

  private broadcastTyping(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const roomTyping = this.typingState.get(roomCode);

    const typingUsers: { id: string; name: string; color: string }[] = [];
    if (roomTyping) {
      for (const uid of roomTyping.keys()) {
        const u = room.users.get(uid);
        if (u) typingUsers.push({ id: u.id, name: u.name, color: u.color });
      }
    }

    this.broadcast(room, { type: 'typing_update', users: typingUsers });
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getRoomForUser(userId: string): Room | undefined {
    const code = this.userRoomMap.get(userId);
    return code ? this.rooms.get(code) : undefined;
  }

  findUserByName(room: Room, name: string): User | undefined {
    for (const u of room.users.values()) {
      if (u.name.toLowerCase() === name.toLowerCase()) return u;
    }
    return undefined;
  }

  changeUserName(room: Room, userId: string, newName: string): boolean {
    const user = room.users.get(userId);
    if (!user) return false;
    const oldName = user.name;
    user.name = newName;

    const msg: Message = {
      type: 'system',
      text: `${oldName} is now known as ${newName}.`,
      ts: Date.now(),
    };
    room.messageHistory.push(msg);
    this.broadcast(room, { type: 'user_updated', userId, changes: { name: newName } });
    this.broadcast(room, { type: 'chat_message', message: msg });
    return true;
  }

  changeUserColor(room: Room, userId: string, colorName: string): string | null {
    const user = room.users.get(userId);
    if (!user) return 'User not found';

    const takenColors = new Set<string>();
    for (const u of room.users.values()) {
      if (u.id !== userId) takenColors.add(u.colorName);
    }

    const { COLORS } = require('./utils');
    const color = COLORS.find((c: { name: string }) => c.name === colorName.toLowerCase());
    if (!color) return `Unknown color. Available: ${COLORS.map((c: { name: string }) => c.name).join(', ')}`;
    if (takenColors.has(color.name)) return `${color.name} is already taken.`;

    user.color = color.hex;
    user.colorName = color.name;

    this.broadcast(room, {
      type: 'user_updated',
      userId,
      changes: { color: color.hex, colorName: color.name },
    });
    return null;
  }

  private destroyRoom(code: string): void {
    this.ptyManager.killAllPtys(code);
    this.rooms.delete(code);
    this.cleanupTimers.delete(code);
    this.typingState.delete(code);
  }

  broadcast(room: Room, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const user of room.users.values()) {
      if (user.ws.readyState === 1) {
        try {
          user.ws.send(data);
        } catch {
          // ignore
        }
      }
    }
  }

  broadcastToOthers(room: Room, excludeUserId: string, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const user of room.users.values()) {
      if (user.id !== excludeUserId && user.ws.readyState === 1) {
        try {
          user.ws.send(data);
        } catch {
          // ignore
        }
      }
    }
  }

  sendTo(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // ignore
      }
    }
  }

  private pruneMessages(room: Room): void {
    if (room.messageHistory.length > 500) {
      room.messageHistory = room.messageHistory.slice(-500);
    }
  }
}
