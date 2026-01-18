'use client';

import { Plus } from 'lucide-react';

interface NewChatButtonProps {
  onClick?: () => void;
}

export function NewChatButton({ onClick }: NewChatButtonProps) {
  return (
    <button
      onClick={onClick}
      className="
        w-14 h-14 rounded-full
        bg-[#181818] hover:bg-[#333333]
        flex items-center justify-center
        shadow-lg hover:shadow-xl
        transition-all duration-200
        active:scale-95
      "
      aria-label="New chat"
    >
      <Plus className="w-7 h-7 text-white" />
    </button>
  );
}
