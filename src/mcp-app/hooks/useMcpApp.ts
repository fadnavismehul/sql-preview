import { useEffect, useState, useRef } from 'react';
import { App } from '@modelcontextprotocol/ext-apps';

export function useMcpApp() {
  const appRef = useRef<App | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Initialize App on mount
  if (!appRef.current) {
    appRef.current = new App({
      name: 'SQL Preview',
      version: '1.0.0',
    });
  }

  useEffect(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }

    app.connect();

    // Handle theme changes
    app.onhostcontextchanged = context => {
      if (context?.theme === 'dark' || context?.theme === 'light') {
        setTheme(context.theme);
      }
    };

    // Initial theme check
    const context = app.getHostContext();
    if (context?.theme === 'dark' || context?.theme === 'light') {
      setTheme(context.theme);
    }

    return () => {
      app.close();
    };
  }, []);

  return {
    app: appRef.current,
    theme,
  };
}
