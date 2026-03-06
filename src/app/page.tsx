'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WS_URL } from './lib/constants';

type Mode = 'idle' | 'create' | 'join' | 'roulette';

export default function LobbyPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [visibility, setVisibility] = useState<'private' | 'open'>('private');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [rouletteStatus, setRouletteStatus] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const validateName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return false;
    }
    if (trimmed.length > 20) {
      setError('Name must be 20 characters or less.');
      return false;
    }
    setError('');
    return true;
  };

  const handleCreate = () => {
    if (!validateName()) return;
    if (mode !== 'create') {
      setMode('create');
      return;
    }
    const code = visibility === 'open' ? 'CREATE:open' : 'CREATE';
    router.push(`/room/${encodeURIComponent(code)}?name=${encodeURIComponent(name.trim())}&visibility=${visibility}`);
  };

  const handleJoin = () => {
    if (!validateName()) return;
    if (mode !== 'join') {
      setMode('join');
      return;
    }
    const code = roomCode.trim().toUpperCase();
    if (!code || code.length < 4) {
      setError('Enter a valid room code.');
      return;
    }
    router.push(`/room/${encodeURIComponent(code)}?name=${encodeURIComponent(name.trim())}`);
  };

  const handleRoulette = () => {
    if (!validateName()) return;
    setMode('roulette');
    setRouletteStatus('Connecting to shell...');

    // Connect to WS just for roulette request
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'roulette_request' }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'roulette_match') {
        setRouletteStatus('Match found!');
        setTimeout(() => {
          router.push(`/room/${encodeURIComponent(msg.roomCode)}?name=${encodeURIComponent(name.trim())}`);
        }, 500);
      } else if (msg.type === 'roulette_no_match') {
        setRouletteStatus('');
        setError('No open shells right now. Create one?');
        setMode('create');
        setVisibility('open');
      }
      ws.close();
    };
    ws.onerror = () => {
      setRouletteStatus('');
      setError('Could not connect to server.');
      setMode('idle');
    };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'join') handleJoin();
      else if (mode === 'create') handleCreate();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#1e1e1e' }}>
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#d4d4d4' }}>
            ShellShare
          </h1>
          <p className="text-sm" style={{ color: '#6a737d' }}>
            multiplayer terminal sessions
          </p>
        </div>

        <div className="space-y-4">
          {/* Name input */}
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && mode === 'idle') {
                setMode('create');
              }
            }}
            placeholder="Enter your name..."
            maxLength={20}
            className="w-full px-4 py-3 rounded text-sm outline-none"
            style={{
              background: '#252526',
              color: '#d4d4d4',
              border: '1px solid #333',
              fontFamily: 'inherit',
            }}
          />

          {/* Error */}
          {error && (
            <p className="text-sm" style={{ color: '#f85149' }}>
              {error}
            </p>
          )}

          {/* Roulette status */}
          {rouletteStatus && (
            <p className="text-sm text-center typing-dots" style={{ color: '#3fb950' }}>
              {rouletteStatus}
            </p>
          )}

          {/* Create mode - visibility toggle */}
          {mode === 'create' && (
            <div className="flex gap-2 items-center justify-center">
              <button
                onClick={() => setVisibility('private')}
                className="px-4 py-1.5 rounded text-xs transition-colors"
                style={{
                  background: visibility === 'private' ? '#333' : 'transparent',
                  color: visibility === 'private' ? '#d4d4d4' : '#6a737d',
                  border: '1px solid #333',
                }}
              >
                Private
              </button>
              <button
                onClick={() => setVisibility('open')}
                className="px-4 py-1.5 rounded text-xs transition-colors"
                style={{
                  background: visibility === 'open' ? '#333' : 'transparent',
                  color: visibility === 'open' ? '#3fb950' : '#6a737d',
                  border: '1px solid #333',
                }}
              >
                Open
              </button>
            </div>
          )}

          {/* Join mode - room code input */}
          {mode === 'join' && (
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="Enter room code..."
              className="w-full px-4 py-3 rounded text-sm outline-none uppercase tracking-wider"
              style={{
                background: '#252526',
                color: '#d4d4d4',
                border: '1px solid #333',
                fontFamily: 'inherit',
              }}
              autoFocus
            />
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              className="flex-1 py-3 rounded text-sm font-medium transition-colors"
              style={{
                background: mode === 'create' ? '#58a6ff' : '#252526',
                color: mode === 'create' ? '#000' : '#d4d4d4',
                border: '1px solid #333',
              }}
            >
              {mode === 'create' ? 'Create Room' : 'Create'}
            </button>
            <button
              onClick={handleJoin}
              className="flex-1 py-3 rounded text-sm font-medium transition-colors"
              style={{
                background: mode === 'join' ? '#58a6ff' : '#252526',
                color: mode === 'join' ? '#000' : '#d4d4d4',
                border: '1px solid #333',
              }}
            >
              {mode === 'join' ? 'Join Room' : 'Join'}
            </button>
            <button
              onClick={handleRoulette}
              className="flex-1 py-3 rounded text-sm font-medium transition-colors"
              style={{
                background: '#252526',
                color: '#d29922',
                border: '1px solid #333',
              }}
            >
              Roulette
            </button>
          </div>

          {mode !== 'idle' && (
            <button
              onClick={() => {
                setMode('idle');
                setError('');
              }}
              className="w-full text-center text-xs py-2"
              style={{ color: '#6a737d' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
