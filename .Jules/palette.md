## 2024-05-22 - Accessibility in VS Code Webviews
**Learning:** VS Code webviews are just HTML/JS, but they often lack standard accessibility features like proper label associations and ARIA labels on icon-only buttons. Screen readers treat them as web content, so standard WCAG guidelines apply.
**Action:** Always verify `for` attributes on labels and `aria-label` on icon-only buttons when working with Webview HTML generation.
## 2025-05-23 - Custom Tab Accessibility
**Learning:** Custom tab implementations in Webviews require manual management of ARIA roles ('tablist', 'tab', 'tabpanel') and keyboard event handlers (Enter/Space) to be accessible. Native HTML elements don't provide this behavior automatically for div-based tabs.
**Action:** When creating custom tab controls, explicitly add ARIA roles and keydown listeners for keyboard activation.
