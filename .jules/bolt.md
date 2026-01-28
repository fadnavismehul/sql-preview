## 2024-05-22 - Redundant String Search in Hot Path
**Learning:** `PrestoCodeLensProvider` was performing an O(N*M) search using `indexOf` to find query offsets, despite the parser already knowing them. This is a common anti-pattern when consuming parser outputs.
**Action:** Always check if the parser/tokenizer can provide location data directly (ranges/offsets) to avoid re-scanning the text. Refactored `iterateSqlStatements` to export this data.

## 2024-05-24 - Avoiding String Allocations in Tokenizer
**Learning:** `iterateSqlStatements` was creating intermediate substrings and using `.trim()` just to find the start/end indices of content. This caused unnecessary garbage collection pressure.
**Action:** Replaced `.substring().trim()` with manual forward/backward loops checking for whitespace. This yields indices directly without allocation.
