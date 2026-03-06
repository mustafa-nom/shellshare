'use client';

import { useState } from 'react';
import type { Suggestion } from '../lib/types';

interface SuggestionPanelProps {
  suggestions: Suggestion[];
  isDriver: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export default function SuggestionPanel({ suggestions, isDriver, onAccept, onReject }: SuggestionPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (suggestions.length === 0) return null;

  return (
    <div style={{ borderBottom: '1px solid #333' }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-1.5 text-xs"
        style={{ background: '#252526', color: '#d4d4d4', border: 'none', cursor: 'pointer' }}
      >
        <span>Suggestions ({suggestions.length})</span>
        <span style={{ color: '#6a737d' }}>{collapsed ? '+' : '-'}</span>
      </button>
      {!collapsed && (
        <div className="px-4 py-2 flex flex-col gap-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              style={{
                background: '#2a2d2e',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '8px 10px',
              }}
            >
              <div className="flex items-center justify-between text-xs" style={{ marginBottom: 4 }}>
                <div className="flex items-center gap-1.5">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: s.color,
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: s.color }}>{s.userName}</span>
                  <span style={{ color: '#6a737d' }}>#{i + 1}</span>
                </div>
                <span style={{ color: '#6a737d', fontSize: 11 }}>{timeAgo(s.ts)}</span>
              </div>
              <div className="text-xs" style={{ color: '#d4d4d4', wordBreak: 'break-word' }}>
                {s.text}
              </div>
              {isDriver && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => onAccept(s.id)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: '#1a2e1a',
                      color: '#3fb950',
                      border: '1px solid #3fb950',
                      cursor: 'pointer',
                    }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onReject(s.id)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: '#3a1a1a',
                      color: '#f85149',
                      border: '1px solid #f85149',
                      cursor: 'pointer',
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
