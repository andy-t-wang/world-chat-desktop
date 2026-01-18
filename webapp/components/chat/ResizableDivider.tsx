'use client';

import { useCallback, useEffect, useRef } from 'react';

interface ResizableDividerProps {
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export function ResizableDivider({ onResize, onResizeEnd }: ResizableDividerProps) {
  const isDragging = useRef(false);
  const lastX = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onResizeEnd?.();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onResize, onResizeEnd]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className="hidden md:block w-px bg-[var(--border-subtle)] hover:bg-[var(--accent-blue)]/30 cursor-col-resize transition-colors flex-shrink-0 relative"
    >
      {/* Wider hit area for easier grabbing */}
      <div className="absolute inset-y-0 -left-2 -right-2" />
    </div>
  );
}
