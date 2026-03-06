'use client';

import { useState, useRef, useEffect } from 'react';
import type { TerminalTab, Phase } from '../lib/types';
import PhaseTracker from './PhaseTracker';

interface TerminalTabsProps {
  terminals: TerminalTab[];
  activeTerminalId: string;
  onSwitchTerminal: (id: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (id: string) => void;
  onRenameTerminal: (id: string, label: string) => void;
  onLeave: () => void;
  isMobile: boolean;
  isOpen: boolean;
  onToggle: () => void;
  mode?: 'normal' | 'claude-code';
  phases?: Phase[];
  isDriver?: boolean;
  onAddPhase?: (name: string) => void;
  onUpdatePhase?: (id: string, status: 'pending' | 'in-progress' | 'completed') => void;
  onRemovePhase?: (id: string) => void;
}

export default function TerminalTabs({
  terminals,
  activeTerminalId,
  onSwitchTerminal,
  onNewTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onLeave,
  isMobile,
  isOpen,
  onToggle,
  mode,
  phases,
  isDriver,
  onAddPhase,
  onUpdatePhase,
  onRemovePhase,
}: TerminalTabsProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEditing = (tab: TerminalTab) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRenameTerminal(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
  };

  const sidebarContent = (
    <div
      className="flex flex-col h-full"
      style={{
        width: isMobile ? 200 : 150,
        background: '#252526',
        borderLeft: '1px solid #404040',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1"
        style={{ borderBottom: '1px solid #333' }}
      >
        <span
          className="text-xs uppercase"
          style={{ color: '#6a737d', letterSpacing: '1px', fontSize: 11 }}
        >
          Terminals
        </span>
        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="text-sm px-1 transition-colors"
              style={{ color: '#6a737d', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#d4d4d4')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#6a737d')}
            >
              +
            </button>
            {showDropdown && (
              <div
                className="absolute right-0 top-full mt-1 rounded text-xs z-10"
                style={{
                  background: '#1e1e1e',
                  border: '1px solid #333',
                  minWidth: 130,
                }}
              >
                <button
                  onClick={() => {
                    onNewTerminal();
                    setShowDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 transition-colors"
                  style={{ color: '#d4d4d4' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2d2e')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  New Terminal
                </button>
                <button
                  onClick={() => setShowDropdown(false)}
                  className="w-full text-left px-3 py-2 transition-colors"
                  style={{ color: '#6a737d' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2d2e')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {isMobile && (
            <button
              onClick={onToggle}
              className="text-sm px-1"
              style={{ color: '#6a737d', cursor: 'pointer' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {terminals.map((tab) => {
          const isActive = tab.id === activeTerminalId;
          const isEditing = editingId === tab.id;
          return (
            <div
              key={tab.id}
              onClick={() => {
                onSwitchTerminal(tab.id);
                if (isMobile) onToggle();
              }}
              className="flex items-center gap-2 px-3 py-1 cursor-pointer text-xs group"
              style={{
                background: isActive ? '#37373d' : 'transparent',
                borderLeft: isActive ? '2px solid #58a6ff' : '2px solid transparent',
                color: '#d4d4d4',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = '#2a2d2e';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value.slice(0, 15))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={15}
                  className="flex-1 bg-transparent outline-none text-xs"
                  style={{
                    color: '#d4d4d4',
                    border: '1px solid #58a6ff',
                    borderRadius: 2,
                    padding: '0 2px',
                    width: '100%',
                    minWidth: 0,
                  }}
                />
              ) : (
                <span
                  className="flex-1 truncate"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEditing(tab);
                  }}
                >
                  {tab.label}
                </span>
              )}
              {terminals.length > 1 && !isEditing && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTerminal(tab.id);
                  }}
                  className={`${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity text-xs`}
                  style={{ color: '#6a737d' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#f85149')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#6a737d')}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Phase Tracker (claude-code mode) */}
      {mode === 'claude-code' && phases && onAddPhase && onUpdatePhase && onRemovePhase && (
        <PhaseTracker
          phases={phases}
          isDriver={isDriver || false}
          onAdd={onAddPhase}
          onUpdate={onUpdatePhase}
          onRemove={onRemovePhase}
        />
      )}

      {/* Leave Room */}
      <div style={{ borderTop: '1px solid #333' }}>
        <button
          onClick={onLeave}
          className="w-full py-2 text-sm transition-colors"
          style={{ color: '#f85149', background: 'transparent', border: 'none' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#3a1a1a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          Leave Room
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    if (!isOpen) return null;
    return (
      <>
        <div className="mobile-backdrop" onClick={onToggle} />
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 30 }}>
          {sidebarContent}
        </div>
      </>
    );
  }

  return sidebarContent;
}
