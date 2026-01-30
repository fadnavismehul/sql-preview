# Sentinel's Journal

This document tracks critical security learnings, vulnerability patterns, and architectural gaps identified by Sentinel.

## 2026-01-30 - CSV Injection (Formula Injection) in Exports
**Vulnerability:** The `ExportService` generated CSV files without sanitizing cell values. User-controlled data starting with `=, +, -, @` could be interpreted as formulas by spreadsheet software (Excel, Google Sheets), potentially leading to command execution or data exfiltration when a user opens the exported file.
**Learning:** Standard CSV escaping (wrapping in double quotes) is insufficient to prevent formula injection. Spreadsheet software interprets formulas even inside quoted cells if they start with triggers.
**Prevention:** Prepend a single quote `'` to any field value starting with `=, +, -, @`. This forces the spreadsheet software to treat the content as a string literal.
