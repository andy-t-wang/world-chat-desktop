import { ReactNode } from 'react';

interface ChatLayoutProps {
  children: ReactNode;
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  return (
    <div className="h-dvh w-full bg-[#F5F5F5] flex overflow-hidden">
      {children}
    </div>
  );
}
