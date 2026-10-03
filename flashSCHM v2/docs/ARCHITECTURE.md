# Architecture

`index.html` loads the shipped classic script `app.bundle.js`, generated from the ES-module entry point `js/app.js`. This preserves double-click / `file://` use without sacrificing source module boundaries. esbuild is used only when developers regenerate this distribution file. `initApp()` creates explicit state, initializes the timeline adapter once, registers UI events and renders. Initialization no longer calls functions before their datasets exist.

| Module | Responsibility |
| --- | --- |
| `state.js` | Department constants, default state, actor/task/professional IDs |
| `utils/ids.js` | IDs with a fallback for browsers without `crypto.randomUUID` |
| `utils/time.js` | Integer-minute arithmetic, explicit parsing/formatting/rounding, interval overlap, actual arrival |
| `scheduling/rules.js` | Additive inheritance, normalization, consistency, candidate validation and scoring |
| `scheduling/scheduler.js` | Pure READY-anchored scheduling and structured results |
| `scheduling/professionals.js` | Separate pure availability, available set, selection and explicit reservation |
| `scheduling/conflicts.js` | Domain conflicts and manual schedule edits |
| `ui/` | DOM rendering and rule controls; human-readable Italian diagnostics |
| `timeline/timeline.js` | vis datasets, metadata, selection and edit callbacks |
| `io/xlsx.js` | Pure project/row conversion plus injected SheetJS workbook adapter |

## State boundaries

State is `{actors, professionals, settings, rules, diagnostics}`. `settings.defaultReady` is the READY assigned to new actors; the explicit **Applica a tutti** action copies it into existing actors. Each actor keeps an independent `ready` value, so changing the default alone does not alter a generated schedule. Professionals are arrays per department of `{id, name}`. Their order is the explicit fallback selection order. Actor priority and READY determine actor scheduling order, not row position or UUID ordering.

Actors contain `{id, name, ready, priority, tasks, rules, schedule, arrival}`. Each source task contains `{id, actorId, type, duration}`. Zero-duration source tasks retain IDs but are omitted from scheduling. A scheduled task adds `{start, end, professionalId}`. Names are rendered through `textContent`; they are never parsed for identity.

Generate is a pure function: it uses temporary candidate schedules and returns new scheduled actor records, professional reservations and diagnostics. It never alerts, accesses DOM, invokes XLSX or calls vis. The controller copies only resulting schedule/arrival fields back into the live actor records, so input handlers keep valid bindings. Table rendering reads state; the DOM does not serve as storage.

Manual edits mutate only the identified scheduled task, then recalculate arrival and reusable conflicts, and redraw views. Source task duration remains the automatic scheduling input; a resized manual block is retained until the next Generate. Professional reservations used by automatic scheduling are rebuilt on every Generate, not maintained as a second mutable source of truth.

## Pipeline

1. Canonical department/task ordering and input validation.
2. Resolve global and actor rules.
3. Normalize semantic ordering rules and validate required-rule consistency.
4. Enumerate the small set of permutations.
5. Reject required-order violations; rank preferences.
6. Test backwards placement against professional reservations and actor non-overlap.
7. Check hard ordering again against actual chronological placement.
8. Compare actual arrivals, retaining preference rank on ties; commit only the chosen schedule.
9. Return structured results and diagnostics.

The latest-arrival comparison is the review-requested correction to legacy first-feasible acceptance. Other actors' committed reservations are read-only during candidate trials; no full-project deep cloning is used.

## Time and limitations

Minutes are integer offsets within one day. READY is 0..1439. Scheduled tasks must start at or after zero and finish by READY. Arithmetic itself does not wrap; `formatTime` allows 1440 as the boundary label 24:00 for manual end times. Automatic arrivals and backwards probes use five-minute rounding; task durations remain exact integer minutes, including legacy durations that are not multiples of five. Consequently a sequential task boundary may be off-grid, as in the original algorithm.

No prior-day scheduling, unavailable windows, earliest/latest arrival rules or gap constraints are implemented. These were future examples in the request, not existing features. Add new explicit rule types and corresponding temporal validation/placement when needed, without moving policy into UI or timeline.

## Timeline lifecycle and layout

One instance and one select listener are created. `render()` refreshes structured datasets; it does not append subscriptions. Items carry task/actor/department/professional IDs. Groups carry department and professional IDs. Invalid cross-department moves are rejected. Actual actor/professional overlaps, READY and required-rule violations remain visible.

A zero horizontal margin lets adjacent time ranges share a row while true overlaps remain stacked. Vertical spacing is independent. See the [official vis-timeline margin options](https://visjs.github.io/vis-timeline/docs/timeline/#Configuration_Options). We do not disable stacking or use large negative margins that could conceal real overlaps.
