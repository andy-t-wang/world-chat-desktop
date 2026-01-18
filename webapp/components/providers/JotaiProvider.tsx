'use client';

import { Provider } from 'jotai';
import { ReactNode } from 'react';
import { store } from '@/stores';

interface JotaiProviderProps {
  children: ReactNode;
}

export function JotaiProvider({ children }: JotaiProviderProps) {
  return <Provider store={store}>{children}</Provider>;
}
