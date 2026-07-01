import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

// Shared external store so every consumer (sidebar toggle, Sonner toaster, …)
// reflects a single source of truth and re-renders together on change.
let listeners: Array<() => void> = [];

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let currentTheme: Theme = readInitialTheme();

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // shadcn dark mode is driven by the `.dark` class on <html>.
  root.classList.toggle('dark', theme === 'dark');
  // Keep the legacy DeliverPro token system (`[data-theme]`) in sync so any
  // preserved components that still read CSS custom properties stay correct.
  root.setAttribute('data-theme', theme);
}

/**
 * Apply the persisted theme to the document before first paint.
 * Call once from the app entry point to avoid a flash of the wrong theme.
 */
export function initTheme(): void {
  applyTheme(currentTheme);
}

function setTheme(theme: Theme): void {
  currentTheme = theme;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return 'light';
}

export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    theme,
    toggle: () => setTheme(currentTheme === 'dark' ? 'light' : 'dark'),
    setTheme,
  };
}
