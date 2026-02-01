## 2026-02-01 - Accessible Custom Tabs
**Learning:** Custom tab implementations using `<div>` elements are invisible to screen readers and keyboard users unless they explicitly define `role="tab"`, `tabindex`, and handle keyboard events (Enter/Space/Arrows).
**Action:** Always check custom interactive elements for semantic roles and keyboard support. For tabs, implement `role="tablist"` on the container and `role="tab"` on items, with roving tabindex or manual focus management.
