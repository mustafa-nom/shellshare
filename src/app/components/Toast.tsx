'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  exiting?: boolean;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const COLORS: Record<ToastType, string> = {
  info: '#58a6ff',
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
};

export function ToastProvider({ children, isMobile }: { children: React.ReactNode; isMobile?: boolean }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => {
      const t = prev.find(t => t.id === id);
      if (t && !t.exiting) {
        return prev.map(t => t.id === id ? { ...t, exiting: true } : t);
      }
      return prev;
    });
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++counterRef.current;
    setToasts(prev => {
      const next = [...prev, { id, type, message }];
      // Max 3 visible - dismiss oldest first
      if (next.length > 3) {
        const oldest = next[0];
        setTimeout(() => removeToast(oldest.id), 0);
      }
      return next;
    });
    setTimeout(() => removeToast(id), 4000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: isMobile ? 60 : 16,
          right: isMobile ? '50%' : 16,
          transform: isMobile ? 'translateX(50%)' : undefined,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{
              background: '#1e1e1e',
              border: `1px solid ${COLORS[toast.type]}`,
              borderLeft: `3px solid ${COLORS[toast.type]}`,
              borderRadius: 6,
              padding: '8px 12px',
              color: '#d4d4d4',
              fontSize: 12,
              maxWidth: 300,
              minWidth: 200,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              pointerEvents: 'auto',
              animation: toast.exiting ? 'toast-exit 0.3s ease-out forwards' : 'toast-enter 0.3s ease-out',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#6a737d',
                cursor: 'pointer',
                fontSize: 14,
                padding: 0,
                lineHeight: 1,
              }}
            >
              x
            </button>
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes toast-enter {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes toast-exit {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(8px); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
