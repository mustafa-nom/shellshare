'use client';

import { useState, useRef, useEffect } from 'react';

interface RoomInfoBarProps {
  roomCode: string;
  isAdmin: boolean;
  userCount: number;
  locked: boolean;
  visibility: 'private' | 'open';
  isMobile: boolean;
  onToggleSidebar?: () => void;
  mode?: 'normal' | 'claude-code';
  driverName?: string;
  myRole?: 'driver' | 'spectator' | null;
  onRequestDrive?: () => void;
  onReleaseDrive?: () => void;
}

export default function RoomInfoBar({ roomCode, isAdmin, userCount, locked, visibility, isMobile, onToggleSidebar, mode, driverName, myRole, onRequestDrive, onReleaseDrive }: RoomInfoBarProps) {
  const [copied, setCopied] = useState(false);
  const [driveRequestCooldown, setDriveRequestCooldown] = useState(false);
  const cooldownRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  };

  return (
    <div
      className="flex items-center justify-between px-4 py-1.5 text-xs select-none"
      style={{
        background: '#252526',
        borderBottom: '1px solid #333',
        color: '#d4d4d4',
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span>
          Room:{' '}
          <button
            onClick={handleCopy}
            className="font-medium hover:underline"
            style={{ color: '#58a6ff' }}
            title="Click to copy"
          >
            {roomCode}
          </button>
          {copied ? (
            <span className="ml-1" style={{ color: '#3fb950' }}>
              ✓
            </span>
          ) : (
            <span className="ml-1 cursor-pointer" onClick={handleCopy} style={{ color: '#6a737d' }}>
              ⧉
            </span>
          )}
        </span>

        {isAdmin && (
          <span
            className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
            style={{ color: '#d29922', background: '#3a2e10' }}
          >
            ★ admin
          </span>
        )}

        {locked && (
          <span className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap" style={{ color: '#f85149', background: '#3a1a1a' }}>
            Locked
          </span>
        )}

        {visibility === 'open' && (
          <span className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap" style={{ color: '#3fb950', background: '#1a3a1a' }}>
            Open
          </span>
        )}

        {mode === 'claude-code' && (
          <span className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap" style={{ color: '#bc8cff', background: '#2d1f4e' }}>
            Claude Code
          </span>
        )}

        {mode === 'claude-code' && driverName && (
          <span className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap" style={{ color: '#3fb950', background: '#1a2e1a' }}>
            Driver: {driverName}
          </span>
        )}

        {mode === 'claude-code' && myRole === 'spectator' && !driverName && (
          <span className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap" style={{ color: '#6a737d' }}>
            No driver
          </span>
        )}

        {mode === 'claude-code' && myRole === 'spectator' && (
          <>
            <span className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap" style={{ color: '#6a737d' }}>
              Spectating
            </span>
            <button
              onClick={() => {
                if (driveRequestCooldown) return;
                onRequestDrive?.();
                setDriveRequestCooldown(true);
                cooldownRef.current = setTimeout(() => setDriveRequestCooldown(false), 30000);
              }}
              disabled={driveRequestCooldown}
              className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
              style={{
                color: driveRequestCooldown ? '#4a4a4a' : '#d4d4d4',
                background: 'transparent',
                border: `1px solid ${driveRequestCooldown ? '#333' : '#555'}`,
                cursor: driveRequestCooldown ? 'not-allowed' : 'pointer',
              }}
              title={isMobile ? 'Request Control' : undefined}
            >
              {isMobile ? '\u270B' : 'Request Control'}
            </button>
          </>
        )}

        {mode === 'claude-code' && myRole === 'driver' && (
          <button
            onClick={onReleaseDrive}
            className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
            style={{
              color: '#d29922',
              background: 'transparent',
              border: '1px solid #d29922',
              cursor: 'pointer',
            }}
            title={isMobile ? 'Release Control' : undefined}
          >
            {isMobile ? '\u21A9' : 'Release Control'}
          </button>
        )}
      </div>

      {isMobile ? (
        <button
          onClick={onToggleSidebar}
          style={{
            width: 30,
            height: 30,
            border: '1px solid #404040',
            borderRadius: 6,
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      ) : (
        <span style={{ color: '#6a737d' }}>{userCount} online</span>
      )}
    </div>
  );
}
