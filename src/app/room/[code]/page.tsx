'use client';

import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSound } from '../../hooks/useSound';
import TerminalView from '../../components/TerminalView';

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = decodeURIComponent(params.code as string);
  const name = searchParams.get('name') || 'Anonymous';
  const [kicked, setKicked] = useState(false);

  const ws = useWebSocket(code, name);
  const { playMessageSound, playJoinSound, playLeaveSound } = useSound();

  // Play sounds on events
  useEffect(() => {
    if (ws.messages.length === 0) return;
    const lastMsg = ws.messages[ws.messages.length - 1];
    if (lastMsg.type === 'system') {
      if (lastMsg.text.includes('has joined')) {
        playJoinSound();
      } else if (lastMsg.text.includes('has left') || lastMsg.text.includes('was kicked')) {
        playLeaveSound();
      }
    } else if (lastMsg.type === 'user' && lastMsg.userId !== ws.userId) {
      playMessageSound();
    }
  }, [ws.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle kicked
  useEffect(() => {
    if (ws.error?.includes('kicked')) {
      setKicked(true);
    }
  }, [ws.error]);

  const handleLeave = () => {
    ws.clearSession();
    router.push('/');
  };

  if (kicked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#1e1e1e' }}>
        <div className="text-center">
          <p className="text-lg mb-4" style={{ color: '#f85149' }}>
            You were kicked from the room.
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 rounded text-sm"
            style={{ background: '#252526', color: '#d4d4d4', border: '1px solid #333' }}
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!ws.isConnected && !ws.roomCode) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#1e1e1e' }}>
        <div className="text-center">
          <p className="text-sm typing-dots" style={{ color: '#6a737d' }}>
            Connecting...
          </p>
          {ws.error && (
            <div className="mt-4">
              <p className="text-sm mb-4" style={{ color: '#f85149' }}>
                {ws.error}
              </p>
              <button
                onClick={() => router.push('/')}
                className="px-6 py-2 rounded text-sm"
                style={{ background: '#252526', color: '#d4d4d4', border: '1px solid #333' }}
              >
                Return to Lobby
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <TerminalView ws={ws} onLeave={handleLeave} />;
}
