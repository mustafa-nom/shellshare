'use client';

import { useState, useRef, useEffect } from 'react';
import type { Phase } from '../lib/types';

interface PhaseTrackerProps {
  phases: Phase[];
  isDriver: boolean;
  onAdd: (name: string) => void;
  onUpdate: (id: string, status: 'pending' | 'in-progress' | 'completed') => void;
  onRemove: (id: string) => void;
}

const NEXT_STATUS: Record<string, 'pending' | 'in-progress' | 'completed'> = {
  'pending': 'in-progress',
  'in-progress': 'completed',
  'completed': 'pending',
};

export default function PhaseTracker({ phases, isDriver, onAdd, onUpdate, onRemove }: PhaseTrackerProps) {
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [adding]);

  const handleSubmit = () => {
    const name = addValue.trim();
    if (name) {
      onAdd(name);
    }
    setAddValue('');
    setAdding(false);
  };

  return (
    <div style={{ borderTop: '1px solid #333' }}>
      <div className="px-3 py-1" style={{ borderBottom: '1px solid #333' }}>
        <span
          className="text-xs uppercase"
          style={{ color: '#6a737d', letterSpacing: '1px', fontSize: 11 }}
        >
          Milestones
        </span>
      </div>

      <div className="py-1">
        {phases.map(phase => (
          <div
            key={phase.id}
            className="flex items-center gap-2 px-3 py-1 text-xs group"
            style={{
              cursor: isDriver ? 'pointer' : 'default',
              color: '#d4d4d4',
            }}
            onClick={() => {
              if (isDriver) onUpdate(phase.id, NEXT_STATUS[phase.status]);
            }}
          >
            {/* Status rail line + icon */}
            <div className="flex flex-col items-center" style={{ width: 14 }}>
              <span style={{
                color: phase.status === 'pending' ? '#6a737d'
                  : phase.status === 'in-progress' ? '#58a6ff'
                  : '#3fb950',
                fontSize: 12,
                lineHeight: 1,
              }}>
                {phase.status === 'completed' ? '\u2713' : phase.status === 'in-progress' ? '\u25CF' : '\u25CB'}
              </span>
            </div>

            <span
              className="flex-1 truncate"
              style={{
                textDecoration: phase.status === 'completed' ? 'line-through' : undefined,
                color: phase.status === 'completed' ? '#6a737d' : '#d4d4d4',
                ...(phase.status === 'in-progress' ? { color: '#58a6ff' } : {}),
              }}
            >
              {phase.name}
            </span>

            {isDriver && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(phase.id);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6a737d',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                x
              </button>
            )}
          </div>
        ))}

        {isDriver && (
          <div className="px-3 py-1">
            {adding ? (
              <input
                ref={inputRef}
                value={addValue}
                onChange={e => setAddValue(e.target.value.slice(0, 100))}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') { setAdding(false); setAddValue(''); }
                }}
                onBlur={handleSubmit}
                placeholder="Milestone name..."
                maxLength={100}
                className="w-full bg-transparent outline-none text-xs"
                style={{
                  color: '#d4d4d4',
                  border: '1px solid #58a6ff',
                  borderRadius: 2,
                  padding: '2px 4px',
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="text-xs"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6a737d',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                + Add milestone
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
