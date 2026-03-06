import type { Room, User, Message } from './types';
import { RoomManager } from './RoomManager';
import { cowsay } from './utils';

export class CommandHandler {
  constructor(private roomManager: RoomManager) {}

  handleCommand(room: Room, user: User, text: string): void {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/kick':
        this.handleKick(room, user, args);
        break;
      case '/lock':
        this.handleLock(room, user);
        break;
      case '/unlock':
        this.handleUnlock(room, user);
        break;
      case '/clear':
        this.handleClear(room, user);
        break;
      case '/public':
        this.handleVisibility(room, user, 'open');
        break;
      case '/private':
        this.handleVisibility(room, user, 'private');
        break;
      case '/cowsay':
        this.handleCowsay(room, user, args);
        break;
      case '/matrix':
        this.handleMatrix(room);
        break;
      case '/name':
        this.handleName(room, user, args);
        break;
      case '/color':
        this.handleColor(room, user, args);
        break;
      case '/drive':
        this.handleDrive(room, user);
        break;
      case '/release':
        this.handleRelease(room, user);
        break;
      case '/suggest':
        this.handleSuggest(room, user, args);
        break;
      case '/accept':
        this.handleAccept(room, user, args);
        break;
      case '/reject':
        this.handleReject(room, user, args);
        break;
      case '/phase':
        this.handlePhase(room, user, args);
        break;
      case '/phases':
        this.handlePhases(room, user);
        break;
      default:
        this.roomManager.sendTo(user.ws, {
          type: 'error',
          message: `Unknown command: ${cmd}. Type /help for commands.`,
        });
    }
  }

  private handleKick(room: Room, user: User, targetName: string): void {
    if (!user.isAdmin) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the admin can kick users.' });
      return;
    }
    if (!targetName) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /kick <username>' });
      return;
    }
    const target = this.roomManager.findUserByName(room, targetName);
    if (!target) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: `User "${targetName}" not found.` });
      return;
    }
    this.roomManager.kickUser(room.code, user.id, target.id);
  }

  private handleLock(room: Room, user: User): void {
    if (!user.isAdmin) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the admin can lock the room.' });
      return;
    }
    this.roomManager.lockRoom(room.code, user.id);
  }

  private handleUnlock(room: Room, user: User): void {
    if (!user.isAdmin) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the admin can unlock the room.' });
      return;
    }
    this.roomManager.unlockRoom(room.code, user.id);
  }

  private handleClear(room: Room, user: User): void {
    if (!user.isAdmin) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the admin can clear chat for all. Use /clear locally.' });
      return;
    }
    this.roomManager.clearMessages(room.code, user.id);
  }

  private handleVisibility(room: Room, user: User, visibility: 'private' | 'open'): void {
    if (!user.isAdmin) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the admin can change room visibility.' });
      return;
    }
    this.roomManager.setVisibility(room.code, user.id, visibility);
  }

  private handleCowsay(room: Room, user: User, text: string): void {
    if (!text) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /cowsay <text>' });
      return;
    }
    const art = cowsay(text);
    const message: Message = {
      type: 'cow',
      userId: user.id,
      userName: user.name,
      color: user.color,
      text: art,
      ts: Date.now(),
    };
    this.roomManager.addMessage(room, message);
  }

  private handleMatrix(room: Room): void {
    this.roomManager.broadcast(room, { type: 'matrix' });
  }

  private handleName(room: Room, user: User, newName: string): void {
    if (!newName) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /name <newname>' });
      return;
    }
    if (newName.length > 20) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Name must be 20 characters or less.' });
      return;
    }
    this.roomManager.changeUserName(room, user.id, newName);
  }

  private handleColor(room: Room, user: User, colorName: string): void {
    if (!colorName) {
      const { COLORS } = require('./utils');
      const takenColors = new Set<string>();
      for (const u of room.users.values()) {
        if (u.id !== user.id) takenColors.add(u.colorName);
      }
      const available = COLORS.filter((c: { name: string }) => !takenColors.has(c.name))
        .map((c: { name: string }) => c.name)
        .join(', ');
      this.roomManager.sendTo(user.ws, {
        type: 'error',
        message: `Available colors: ${available}`,
      });
      return;
    }
    const error = this.roomManager.changeUserColor(room, user.id, colorName);
    if (error) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: error });
    }
  }

  // ─── Claude Code Mode Commands ───

  private handleDrive(room: Room, user: User): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/drive is only available in Claude Code rooms.' });
      return;
    }
    if (room.driverId === user.id) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'You are already driving.' });
      return;
    }
    this.roomManager.requestDrive(room.code, user.id);
  }

  private handleRelease(room: Room, user: User): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/release is only available in Claude Code rooms.' });
      return;
    }
    if (room.driverId !== user.id) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'You are not the current driver.' });
      return;
    }
    this.roomManager.releaseDrive(room.code, user.id);
  }

  private handleSuggest(room: Room, user: User, text: string): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/suggest is only available in Claude Code rooms.' });
      return;
    }
    if (!text) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /suggest <text>' });
      return;
    }
    this.roomManager.sendSuggestion(room.code, user.id, text);
  }

  private handleAccept(room: Room, user: User, args: string): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/accept is only available in Claude Code rooms.' });
      return;
    }
    if (room.driverId !== user.id) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the driver can accept suggestions.' });
      return;
    }
    const index = args ? parseInt(args, 10) : undefined;
    if (args && (isNaN(index!) || index! < 1)) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /accept [number]' });
      return;
    }
    this.roomManager.acceptSuggestionByIndex(room.code, user.id, index);
  }

  private handleReject(room: Room, user: User, args: string): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/reject is only available in Claude Code rooms.' });
      return;
    }
    if (room.driverId !== user.id) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the driver can reject suggestions.' });
      return;
    }
    const index = args ? parseInt(args, 10) : undefined;
    if (args && (isNaN(index!) || index! < 1)) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /reject [number]' });
      return;
    }
    this.roomManager.rejectSuggestionByIndex(room.code, user.id, index);
  }

  private handlePhase(room: Room, user: User, args: string): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/phase is only available in Claude Code rooms.' });
      return;
    }
    if (room.driverId !== user.id) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'Only the driver can manage phases.' });
      return;
    }

    const parts = args.split(/\s+/);
    const subCmd = parts[0]?.toLowerCase();
    const rest = parts.slice(1).join(' ');

    switch (subCmd) {
      case 'add': {
        if (!rest) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /phase add <name>' });
          return;
        }
        this.roomManager.addPhase(room.code, user.id, rest);
        break;
      }
      case 'start': {
        if (!rest) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /phase start <name|index>' });
          return;
        }
        const phase = this.roomManager.findPhase(room, rest);
        if (!phase) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: `Phase "${rest}" not found.` });
          return;
        }
        this.roomManager.updatePhase(room.code, user.id, phase.id, 'in-progress');
        break;
      }
      case 'done': {
        if (!rest) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /phase done <name|index>' });
          return;
        }
        const phase = this.roomManager.findPhase(room, rest);
        if (!phase) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: `Phase "${rest}" not found.` });
          return;
        }
        this.roomManager.updatePhase(room.code, user.id, phase.id, 'completed');
        break;
      }
      case 'remove': {
        if (!rest) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /phase remove <name|index>' });
          return;
        }
        const phase = this.roomManager.findPhase(room, rest);
        if (!phase) {
          this.roomManager.sendTo(user.ws, { type: 'error', message: `Phase "${rest}" not found.` });
          return;
        }
        this.roomManager.removePhase(room.code, user.id, phase.id);
        break;
      }
      default:
        this.roomManager.sendTo(user.ws, { type: 'error', message: 'Usage: /phase add|start|done|remove <name|index>' });
    }
  }

  private handlePhases(room: Room, user: User): void {
    if (room.mode !== 'claude-code') {
      this.roomManager.sendTo(user.ws, { type: 'error', message: '/phases is only available in Claude Code rooms.' });
      return;
    }

    if (room.phases.length === 0) {
      this.roomManager.sendTo(user.ws, { type: 'error', message: 'No milestones set. Use /phase add <name> to create one.' });
      return;
    }

    const icons: Record<string, string> = { 'pending': '○', 'in-progress': '●', 'completed': '✓' };
    const lines = room.phases.map((p, i) => `  ${i + 1}. ${icons[p.status]} ${p.name}`).join('\n');
    this.roomManager.sendTo(user.ws, {
      type: 'chat_message',
      message: { type: 'system', text: `Milestones:\n${lines}`, ts: Date.now() },
    });
  }
}
