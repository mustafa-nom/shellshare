'use client';

import { useState, useCallback, useEffect } from 'react';
import RoomInfoBar from './RoomInfoBar';
import TerminalPanel from './TerminalPanel';
import TerminalTabs from './TerminalTabs';
import MatrixRain from './MatrixRain';
import { ToastProvider, useToast } from './Toast';
import { useIsMobile } from '../lib/useIsMobile';

import type { DriveChangeEvent } from '../hooks/useWebSocket';
import type { Suggestion, Phase } from '../lib/types';

interface TerminalViewProps {
  ws: {
    isConnected: boolean;
    userId: string | null;
    roomCode: string | null;
    users: any[];
    messages: any[];
    terminals: any[];
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
    requestDrive: () => void;
    releaseDrive: () => void;
    acceptSuggestion: (id: string) => void;
    rejectSuggestion: (id: string) => void;
    addPhase: (name: string) => void;
    updatePhase: (id: string, status: 'pending' | 'in-progress' | 'completed') => void;
    removePhase: (id: string) => void;
  };
  onLeave: () => void;
}

export default function TerminalView({ ws, onLeave }: TerminalViewProps) {
  const isMobile = useIsMobile();
  return (
    <ToastProvider isMobile={isMobile}>
      <TerminalViewInner ws={ws} onLeave={onLeave} isMobile={isMobile} />
    </ToastProvider>
  );
}

function TerminalViewInner({ ws, onLeave, isMobile }: TerminalViewProps & { isMobile: boolean }) {
  const [activeTerminalId, setActiveTerminalId] = useState<string>(
    ws.terminals[0]?.id || ''
  );
  const [matrixActive, setMatrixActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'terminal' | 'chat'>('terminal');
  const { addToast } = useToast();

  // Register matrix handler
  useEffect(() => {
    ws.onMatrix(() => {
      setMatrixActive(true);
    });
  }, [ws]);

  // Register drive change handler for toasts
  useEffect(() => {
    ws.onDriveChange((event) => {
      switch (event.event) {
        case 'became_driver':
          addToast('success', 'You are now the driver');
          break;
        case 'became_spectator':
          addToast('info', 'You are now spectating');
          break;
        case 'driver_changed':
          addToast('info', `${event.userName} is now driving`);
          break;
        case 'driver_released':
          addToast('info', `${event.userName} released control`);
          break;
        case 'drive_requested':
          addToast('warning', `${event.userName} is requesting control`);
          break;
      }
    });
  }, [ws, addToast]);

  const handleMatrixComplete = useCallback(() => {
    setMatrixActive(false);
  }, []);

  // Keep active terminal synchronized without setState during render
  useEffect(() => {
    if (ws.terminals.length === 0) {
      if (activeTerminalId !== '') setActiveTerminalId('');
      return;
    }

    const hasActive = ws.terminals.some((t: any) => t.id === activeTerminalId);
    if (!hasActive) {
      setActiveTerminalId(ws.terminals[0].id);
    }
  }, [ws.terminals, activeTerminalId]);

  // Disconnection overlay
  const showReconnecting = !ws.isConnected && ws.roomCode;

  return (
    <div className="h-screen h-dvh flex flex-col" style={{ background: '#1e1e1e' }}>
      {/* Room info bar */}
      <RoomInfoBar
        roomCode={ws.roomCode || ''}
        isAdmin={ws.isAdmin}
        userCount={ws.users.length}
        locked={ws.locked}
        visibility={ws.visibility}
        isMobile={isMobile}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
        mode={ws.mode}
        driverName={ws.driverId ? ws.users.find(u => u.id === ws.driverId)?.name : undefined}
        myRole={ws.myRole}
        onRequestDrive={ws.requestDrive}
        onReleaseDrive={ws.releaseDrive}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Matrix rain overlay */}
        <MatrixRain active={matrixActive} onComplete={handleMatrixComplete} />

        {/* Terminal panels — all rendered, inactive hidden via CSS */}
        {ws.terminals.length > 0 ? (
          ws.terminals.map((tab: any) => (
            <div
              key={tab.id}
              style={{
                display: tab.id === activeTerminalId ? 'flex' : 'none',
                flex: 1,
                flexDirection: 'column' as const,
                minHeight: 0,
              }}
            >
              <TerminalPanel
                terminalId={tab.id}
                isActive={tab.id === activeTerminalId}
                messages={ws.messages}
                typingUsers={ws.typingUsers}
                userId={ws.userId}
                users={ws.users}
                isAdmin={ws.isAdmin}
                sendChat={ws.sendChat}
                sendCommand={ws.sendCommand}
                sendPtyInput={ws.sendPtyInput}
                sendTyping={ws.sendTyping}
                resizeTerminal={ws.resizeTerminal}
                onPtyOutput={ws.onPtyOutput}
                isMobile={isMobile}
                mobileView={mobileView}
                mode={ws.mode}
                myRole={ws.myRole}
                suggestions={ws.suggestions}
                onAcceptSuggestion={ws.acceptSuggestion}
                onRejectSuggestion={ws.rejectSuggestion}
              />
            </div>
          ))
        ) : (
          <div className="flex-1" style={{ background: '#1a1a1a' }} />
        )}

        {/* Terminal tabs sidebar */}
        <TerminalTabs
          terminals={ws.terminals}
          activeTerminalId={activeTerminalId}
          onSwitchTerminal={setActiveTerminalId}
          onNewTerminal={ws.createTerminal}
          onCloseTerminal={ws.closeTerminal}
          onRenameTerminal={ws.renameTerminal}
          onLeave={onLeave}
          isMobile={isMobile}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(false)}
          mode={ws.mode}
          phases={ws.phases}
          isDriver={ws.myRole === 'driver'}
          onAddPhase={ws.addPhase}
          onUpdatePhase={ws.updatePhase}
          onRemovePhase={ws.removePhase}
        />

        {/* Reconnection overlay */}
        {showReconnecting && (

          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.7)', zIndex: 40 }}
          >
            <div className="text-center">
              <p className="text-sm typing-dots" style={{ color: '#d29922' }}>
                Reconnecting...
              </p>
              {ws.error && (
                <div className="mt-4">
                  <p className="text-sm mb-3" style={{ color: '#f85149' }}>
                    {ws.error}
                  </p>
                  <button
                    onClick={onLeave}
                    className="px-6 py-2 rounded text-sm"
                    style={{ background: '#252526', color: '#d4d4d4', border: '1px solid #333' }}
                  >
                    Return to Lobby
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <div
          className="flex flex-shrink-0"
          style={{
            height: 52,
            background: '#252526',
            borderTop: '1px solid #333',
          }}
        >
          <button
            onClick={() => setMobileView('terminal')}
            className="flex-1 flex items-center justify-center text-xs"
            style={{
              background: 'transparent',
              border: 'none',
              borderTop: mobileView === 'terminal' ? '2px solid #58a6ff' : '2px solid transparent',
              color: mobileView === 'terminal' ? '#58a6ff' : '#6a737d',
              cursor: 'pointer',
            }}
          >
            <span>Terminal</span>
          </button>
          <button
            onClick={() => setMobileView('chat')}
            className="flex-1 flex items-center justify-center text-xs relative"
            style={{
              background: 'transparent',
              border: 'none',
              borderTop: mobileView === 'chat' ? '2px solid #58a6ff' : '2px solid transparent',
              color: mobileView === 'chat' ? '#58a6ff' : '#6a737d',
              cursor: 'pointer',
            }}
          >
            <span>Chat</span>
            {ws.mode === 'claude-code' && ws.suggestions.length > 0 && mobileView !== 'chat' && (
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  right: '30%',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#f85149',
                  color: '#fff',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {ws.suggestions.length}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
