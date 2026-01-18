"use client";

import { Mail, ChevronRight } from "lucide-react";

interface ChatRequestsBannerProps {
  count: number;
  newCount?: number;
  onClick?: () => void;
}

export function ChatRequestsBanner({
  count,
  newCount = 0,
  onClick,
}: ChatRequestsBannerProps) {
  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors"
    >
      {/* Icon with optional dot */}
      <div className="relative shrink-0">
        <div className="w-[48px] h-[48px] rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
          <Mail className="w-6 h-6 text-[var(--text-primary)]" />
        </div>
        {newCount > 0 && (
          <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-[var(--accent-blue)] border-2 border-[var(--bg-primary)]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 items-start">
        <span className="text-[16px] font-medium text-[var(--text-primary)]">
          Chat requests
        </span>
        <span className="text-[14px] text-[var(--text-secondary)] leading-[1.3]">
          {count} message {count === 1 ? "request" : "requests"}
        </span>
      </div>

      {/* Arrow */}
      <ChevronRight className="w-5 h-5 text-[var(--text-tertiary)] shrink-0" />
    </button>
  );
}
