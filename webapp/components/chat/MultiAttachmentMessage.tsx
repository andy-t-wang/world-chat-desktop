'use client';

interface MultiAttachmentMessageProps {
  isOwnMessage: boolean;
}

/**
 * Placeholder for multi-attachment messages
 * SDK doesn't currently export multi-attachment codec - waiting for fix
 */
export function MultiAttachmentMessage({
  isOwnMessage,
}: MultiAttachmentMessageProps) {
  return (
    <div className={`bg-[#F3F4F5] border border-[rgba(0,0,0,0.1)] rounded-[16px] px-4 py-3 text-[#717680] text-sm max-w-[250px] ${isOwnMessage ? 'ml-auto' : ''}`}>
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-[#9BA3AE]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Multiple images</span>
      </div>
      <p className="text-xs text-[#9BA3AE] mt-1">View in World App</p>
    </div>
  );
}
