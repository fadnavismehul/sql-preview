## 2024-05-22 - Accessibility in VS Code Webviews
**Learning:** VS Code webviews are just HTML/JS, but they often lack standard accessibility features like proper label associations and ARIA labels on icon-only buttons. Screen readers treat them as web content, so standard WCAG guidelines apply.
**Action:** Always verify `for` attributes on labels and `aria-label` on icon-only buttons when working with Webview HTML generation.

## 2024-05-23 - Tab Navigation Complexity
**Learning:** Implementing "Roving Tabindex" (setting inactive tabs to tabindex="-1") requires custom arrow key event handlers to be accessible. Without them, keyboard users get trapped on the active tab. For simple "micro" improvements, setting all tabs to `tabindex="0"` is a safer, more robust default that ensures reachability.
**Action:** When adding `role="tablist"`, either implement full keyboard navigation (arrows) or keep all tabs naturally focusable (`tabindex="0"`) to avoid blocking keyboard users.

## 2024-05-24 - Baked-in Accessibility Attributes
**Learning:** In VS Code Webviews where HTML is generated as a string, including accessibility attributes (ARIA labels, roles) directly in the template is more reliable than adding them via client-side scripts, as it ensures they are present immediately upon render.
**Action:** Always include `aria-label`, `role`, and `aria-live` attributes in the HTML generation logic (`ResultsHtmlGenerator.ts`) rather than deferring to `resultsView.js`.
