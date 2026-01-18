'use client';

import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { themePreferenceAtom, type ThemePreference } from '@/stores/settings';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themePreference = useAtomValue(themePreferenceAtom);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;

    const applyTheme = (theme: ThemePreference) => {
      if (theme === 'system') {
        // Check system preference
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (systemDark) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      } else if (theme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme(themePreference);

    // Listen for system theme changes when in 'system' mode
    if (themePreference === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [themePreference, mounted]);

  return <>{children}</>;
}

// Script to prevent flash of wrong theme on page load
// This runs before React hydration to set the correct theme immediately
export const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme');
      if (theme) {
        theme = JSON.parse(theme);
      }
      var isDark = theme === 'dark' ||
        (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {}
  })();
`;
