## 2026-01-31 - [CSV Injection (Formula Injection)]
**Vulnerability:** The `ExportService` class did not sanitize cell values starting with `=, +, -, @`, allowing execution of formulas in exported CSV files when opened in spreadsheet software (like Excel).
**Learning:** Even when correctly escaping CSV delimiters (quotes), cell contents can still trigger formula execution. Sanitization must precede delimiter escaping. Checking `!isNaN(Number(val))` helps preserve valid numeric data while escaping potential formulas.
**Prevention:** Always check if a cell value starts with dangerous characters (`=, +, -, @`) before exporting to CSV/Excel. If it does, verify if it is a safe number; otherwise, prepend a single quote (`'`) to force text interpretation.
