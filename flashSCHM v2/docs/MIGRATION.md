# Legacy migration and XLS format

## Preserved legacy sheets

`Actors` columns: Nome, OrarioPronti, PrioritaAttore, DurataTrucco, ProfessionistaTrucco, DurataCapelli, ProfessionistaCapelli, DurataCostumi.

`Depts` columns: Reparto, NumeroProfessionisti, NomiProfessionisti, Priorita.

Legacy professional indices are zero-based: zero selects the first professional; blank means Any. Nonblank legacy choices migrate to **required** professional rules because the old engine did not fall back. Names are display labels. Missing referenced professionals are retained as unavailable references so scheduling reports failure, rather than silently changing the selection. Legacy actor/task/professional data gets fresh unique IDs once on import; subsequent versioned exports preserve them.

Professional count zero retains free capacity for that department. Comma-separated names are trimmed, padded with defaults and truncated to the count. Duplicate department priority values use the old fallback 1/2/3. Priority weights rank permutations as before, including nonstandard distinct values. Default priorities 1/2/3 favor Costume → Hair → Makeup; they do not mean required Makeup first.

Legacy READY accepts HH:MM and numeric Excel day fractions. Negative durations, malformed times and structurally invalid projects are rejected before replacing current state.

## Version 3 export

The generated `.xlsx` has a visible `Actors` sheet. Its `ID` column is hidden and ties each row to the actor's rules and tasks. Names, READY, priorities and department durations in this sheet are authoritative on import. Add a row with a blank ID to add an actor, remove a row to delete one, or reorder rows to change input order. Duplicate and unknown IDs are rejected. Changes to scheduling inputs or row order clear all saved schedules and diagnostics; generate a new schedule after importing. Name-only changes preserve the saved schedule.

The hidden `FlashSCHM` sheet contains `Version: 3` and JSON `Data` chunks of at most 30,000 characters. Concatenate Data rows in order to recover the project. Splitting avoids Excel's single-cell text limit. The JSON preserves stable IDs, global and actor rules, professional settings and manual schedules. `Depts` is hidden compatibility data, not an editing surface. Change professionals and advanced rules in the app. Keep both hidden sheets when editing `Actors`.

The project settings also retain `defaultReady`, the READY used for new actors. New rows added in `Actors` with a blank `OrarioPronti` receive this value. Older versioned projects without it import with a 10:00 default; existing actors keep their own READY values.

Version 2 files can also apply changes to the existing actor rows in `Actors`, matched by row position because those exports have no ID column. Re-export with this app before adding, deleting or reordering rows; it adds stable IDs. The older `ProfessionistaTrucco` and `ProfessionistaCapelli` columns are compatibility fields and do not edit advanced rules. `Depts` remains a compatibility snapshot. Legacy files without metadata still use the `Actors` and `Depts` columns described above. Earlier app builds reject version 3 exports. Unknown versions and malformed or duplicate IDs fail validation.

Older application versions cannot represent partial hard constraints, soft professional fallback or override inheritance. The compatibility sheets cannot preserve these in an older application. New-format export is XLSX; legacy XLS/BIFF8 input remains supported. Do not convert versioned metadata to BIFF8 with a writer that truncates long string cells.

## Explicit behavior corrections

Actual arrivals now reflect the earliest scheduled task, not the initial estimate. Midnight no longer wraps task ends into apparently valid READY checks. During review the user requested latest feasible arrival across alternative orders: imported data follows this policy too, while its priorities and professional selections retain their rule meanings. Manual identity uses IDs, so duplicate, hyphenated, punctuation-containing and renamed actors remain distinct.
