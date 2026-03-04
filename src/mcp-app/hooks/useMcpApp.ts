import { useEffect, useState } from 'react';
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';

export function useMcpApp() {
  const [app, setApp] = useState<App | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Create App instance
    const newApp = new App({
      name: 'SQL Preview',
      version: '1.0.0',
    });

    // Handle theme changes using official helpers
    newApp.onhostcontextchanged = context => {
      if (context?.theme === 'dark' || context?.theme === 'light') {
        setTheme(context.theme);
      }
      if (context?.theme) applyDocumentTheme(context.theme);
      if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
      if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);

      if (context?.safeAreaInsets) {
        const { top, right, bottom, left } = context.safeAreaInsets;
        (globalThis as any).document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
      }
    };

    // Initial theme check
    const context = newApp.getHostContext();
    if (context?.theme === 'dark' || context?.theme === 'light') {
      setTheme(context.theme);
      applyDocumentTheme(context.theme);
    }
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);

    // Call connect() AFTER setting up handlers
    newApp.connect();
    setApp(newApp);

    return () => {
      newApp.close();
    };
  }, []);

  return {
    app,
    theme,
  };
}
