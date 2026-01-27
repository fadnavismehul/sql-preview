## 2024-05-22 - Redundant String Search in Hot Path
**Learning:** `PrestoCodeLensProvider` was performing an O(N*M) search using `indexOf` to find query offsets, despite the parser already knowing them. This is a common anti-pattern when consuming parser outputs.
**Action:** Always check if the parser/tokenizer can provide location data directly (ranges/offsets) to avoid re-scanning the text. Refactored `iterateSqlStatements` to export this data.
