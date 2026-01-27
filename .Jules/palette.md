## 2024-05-22 - Accessibility in VS Code Webviews
**Learning:** VS Code webviews are just HTML/JS, but they often lack standard accessibility features like proper label associations and ARIA labels on icon-only buttons. Screen readers treat them as web content, so standard WCAG guidelines apply.
**Action:** Always verify `for` attributes on labels and `aria-label` on icon-only buttons when working with Webview HTML generation.
