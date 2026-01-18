'use client';

import { MessageSquare } from 'lucide-react';

interface EmptyStateProps {
  className?: string;
}

export function EmptyState({ className }: EmptyStateProps) {
  return (
    <div className={`flex-1 flex flex-col items-center justify-center bg-[var(--bg-tertiary)] text-center p-8 ${className || ''}`}>
      <div className="w-20 h-20 rounded-full bg-[var(--bg-primary)] flex items-center justify-center mb-4 shadow-sm">
        <MessageSquare className="w-10 h-10 text-[var(--text-tertiary)]" />
      </div>
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
        Select a conversation
      </h2>
      <p className="text-[var(--text-secondary)] max-w-sm">
        Choose a chat from the sidebar or start a new conversation to begin messaging.
      </p>
    </div>
  );
}
