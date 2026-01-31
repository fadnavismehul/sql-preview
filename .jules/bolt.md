## 2024-05-22 - Redundant String Search in Hot Path
**Learning:** `PrestoCodeLensProvider` was performing an O(N*M) search using `indexOf` to find query offsets, despite the parser already knowing them. This is a common anti-pattern when consuming parser outputs.
**Action:** Always check if the parser/tokenizer can provide location data directly (ranges/offsets) to avoid re-scanning the text. Refactored `iterateSqlStatements` to export this data.

## 2024-05-24 - Efficient Offset Calculation in Parsers
**Learning:** When refactoring parsers to export offsets, avoided using `indexOf` or regex `match` inside loops as they can be slower than the downstream redundant search. `String.prototype.search(/\S/)` was found to be the most efficient way to find the start of trimmed content within a known range, outperforming manual loops and full regex matches.
**Action:** Use `search(/\S/)` to find leading non-whitespace offsets efficiently.
