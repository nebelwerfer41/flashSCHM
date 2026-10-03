# Refactoring and verification report

## Roadmap phase 3: actor catalog

The project now stores a catalog separately from its current plan and saved plan snapshots. Standalone `Catalogo` XLSX files carry stable catalog IDs, names and usual department durations. Import previews every entry; an ID already present requires an explicit keep or replace decision. Multi-select adds independent actor copies with new plan IDs and the current default READY. Project format 5 retains the catalog in metadata; versions 2–4 still import. Automated tests cover duplicate handling, copy independence, backward import and actual SheetJS catalog/project workbook round trips. The shipped classic bundle includes the catalog UI.

## Architecture and engine

Five globally coupled source files were incrementally separated into a vanilla ES-module controller, pure time/rule/scheduling/conflict functions, state-driven DOM views, and timeline/SheetJS adapters. Legacy sources are retained only as immutable test fixtures. The baseline audit and characterization tests were added before the engine extraction.

The original READY-derived backwards placement, priority ordering, five-minute retries, exact durations, unlimited departments and first-available professional tie-breaking remain. The review-requested latest-arrival comparison allows valid department alternation without unnecessarily anticipating actor calls.

## Rules and UI

Global rules inherit additively; actors explicitly add, replace or disable rules. Partial and complete order use the same normalized dependencies. Hard cycles are errors; soft preferences rank valid candidates. Any/prefer/require professional behavior is explicit. Main rows show common fields; crew/global rules and actor exceptions are expandable. Names never become HTML or identifiers.

## Confirmed fixes

- Initial settings invoked timeline code before dataset initialization; initialization now has one explicit entry point. The original failure is reproduced by a VM regression test.
- Actor names collided in item IDs and were split during selection/editing. Metadata now uses stable actor/task IDs; tests include duplicate and hyphenated names.
- Availability checks mutated task assignment. Checks are pure and selection/reservation explicit.
- Arrival could remain later than the actual first task. Both automatic and manual schedules use the actual earliest task.
- Midnight-wrapped task ends could incorrectly pass READY. Single-day numeric comparisons now reject crossing the boundary.
- Timeline refresh appended selection handlers. Repeated-refresh tests assert one subscription.
- Manual professional overlaps were not detected. Actor/professional overlaps and READY/required-rule violations now return structured conflicts; cross-department reassignment is rejected.
- Review: first feasible order anticipated Luigi to 09:00 instead of trying alternation at 09:15. Candidate comparison now chooses the latest feasible arrival, while hard order constraints remain absolute.
- Review: a positive horizontal timeline margin made touching intervals stack. Zero horizontal margin keeps consecutive blocks side by side while actual simultaneous Costume tasks remain stacked.
- Refactor verification caught input handlers retaining obsolete actor objects after generation. Controller now updates schedule fields on the live actor object; edits and subsequent generation remain connected.

## Verification

- Node test suite: legacy characterization, pure core, rule resolution/constraints, XLS row conversion, large metadata, manual editing, timeline lifecycle and UI bindings.
- Actual SheetJS integration: versioned XLSX round trips for 80 synthetic actors (multiple metadata chunks); legacy XLSX and XLS/BIFF8 imports, including professional index zero.
- Browser: initialization without console errors; adding/editing actors; crew capacity changes; global required Costume-last; generation and regeneration; equal arrivals and alternating departments; free-capacity simultaneous Costume; display toggles; compact touching intervals; manual drag updates table/arrival and exposes actor + professional conflicts; regeneration clears conflicts.
- Browser XLS export reported success. Browser import was not completed because the browser authorization layer rejected the file upload. No alternate file-upload mechanism was used. Row and binary workbook import checks passed independently using synthetic fixtures.

## Future extensions

Arrival windows, unavailable periods, task gaps/wait limits and professional-specific rules can be added to normalization/temporal validation and candidate placement. Candidate enumeration can be replaced without changing the rule UI, conflict adapter or import layer. No generic rules framework, optimizer, new backend or frontend framework was introduced.

## Direct-file startup regression fixed

A user reported that professional settings and actor rows did not initialize when index.html was opened with a double click. The refactored HTML used a module script, which browsers restrict on file URLs. The distributed HTML now loads a generated classic script (`app.bundle.js`); modular source and pure-engine tests are retained. esbuild is a development-only packaging dependency, justified by direct-file compatibility; users need no server or build step.

Initialization tests execute the actual shipped script without modules or crypto, verify all three professional sections, add actor rows, edit inputs and generate a schedule. Another test verifies that a timeline constructor error cannot block actor controls. Total suite: 38 passing tests. The integrated browser prohibited file-URL navigation, so direct double-click rendering was not visually verified; startup was verified in the distribution-script harness.
