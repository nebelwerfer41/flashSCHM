# Legacy migration and XLS format

## Preserved legacy sheets

`Actors` columns: Nome, OrarioPronti, PrioritaAttore, DurataTrucco, ProfessionistaTrucco, DurataCapelli, ProfessionistaCapelli, DurataCostumi.

`Depts` columns: Reparto, NumeroProfessionisti, NomiProfessionisti, Priorita.

Legacy professional indices are zero-based: zero selects the first professional; blank means Any. Nonblank legacy choices migrate to **required** professional rules because the old engine did not fall back. Names are display labels. Missing referenced professionals are retained as unavailable references so scheduling reports failure, rather than silently changing the selection. Legacy actor/task/professional data gets fresh unique IDs once on import; subsequent versioned exports preserve them.

Professional count zero retains free capacity for that department. Comma-separated names are trimmed, padded with defaults and truncated to the count. Duplicate department priority values use the old fallback 1/2/3. Priority weights rank permutations as before, including nonstandard distinct values. Default priorities 1/2/3 favor Costume → Hair → Makeup; they do not mean required Makeup first.

Legacy READY accepts HH:MM and numeric Excel day fractions. Negative durations, malformed times and structurally invalid projects are rejected before replacing current state.

## Version 2 export

The generated `.xlsx` retains Actors and Depts for reference/compatibility and adds **FlashSCHM**, with `Version: 2` and JSON `Data` chunks of at most 30,000 characters. Concatenate Data rows in order to recover the project. Splitting avoids Excel's single-cell text limit. This includes stable IDs, global/actor rules, professional settings and manual schedules. Unknown versions and malformed/duplicate IDs fail validation.

**The FlashSCHM sheet is authoritative when present.** Editing only Actors or Depts in a new export will not update the embedded project. To use those sheets as a legacy input, remove FlashSCHM before importing; this intentionally loses IDs, advanced rules and the saved schedule. Keep the original export as a backup.

Older application versions cannot represent partial hard constraints, soft professional fallback or override inheritance. The compatibility sheets cannot preserve these in an older application. New-format export is XLSX; legacy XLS/BIFF8 input remains supported. Do not convert versioned metadata to BIFF8 with a writer that truncates long string cells.

## Explicit behavior corrections

Actual arrivals now reflect the earliest scheduled task, not the initial estimate. Midnight no longer wraps task ends into apparently valid READY checks. During review the user requested latest feasible arrival across alternative orders: imported data follows this policy too, while its priorities and professional selections retain their rule meanings. Manual identity uses IDs, so duplicate, hyphenated, punctuation-containing and renamed actors remain distinct.
