## 2024-05-22 - Accessibility in VS Code Webviews
**Learning:** VS Code webviews are just HTML/JS, but they often lack standard accessibility features like proper label associations and ARIA labels on icon-only buttons. Screen readers treat them as web content, so standard WCAG guidelines apply.
**Action:** Always verify `for` attributes on labels and `aria-label` on icon-only buttons when working with Webview HTML generation.

## 2025-02-20 - Tab Interface Accessibility
**Learning:** Custom tab implementations using `div`s often miss keyboard support. Adding `role="tab"`, `tabindex="0"`, and `keydown` handlers (for Enter/Space) effectively restores standard accessibility without breaking existing styles.
**Action:** When seeing custom tab lists, check for `role="tablist"`, `role="tab"`, and keyboard activation support.
