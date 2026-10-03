# flashSCHM

Vanilla JavaScript scheduler for Makeup (Trucco), Hair (Capelli) and Costume (Costumi). No backend, frontend framework or installation required to use the distributed application.

## Open the application

Extract the **entire ZIP** into a folder, then double-click **index.html**. Keep `app.bundle.js` and `style.css` beside it. A local server is optional, not required.

The source remains split into ES modules under `js/`. The included `app.bundle.js` is a classic script generated from those modules, so browser restrictions on `file://` module imports do not prevent startup. Do not copy only index.html out of the folder.

## Develop and test

Use Node.js 20+ to run tests:

```sh
npm test
```

After editing JavaScript sources, regenerate the included browser file:

```sh
npm ci
npm run build
npm test
```

esbuild is a development-only dependency used solely to support direct file opening. End users do not need Node, npm or a build step. Commit/distribute the regenerated `app.bundle.js` with the source.

For optional HTTP preview, use Python 3:

```sh
npm start
```

Open `http://localhost:8080`. If that port is occupied, use `python3 -m http.server 8766 --bind 127.0.0.1` and open `http://127.0.0.1:8766`.

The page loads the existing SheetJS 0.18.5 dependency and vis-timeline 7.7.3 from their CDNs. Internet access is needed for these adapters. The scheduling core and its tests run without them. If the timeline library is unavailable, actor entry and schedule generation remain usable and the page reports that the timeline could not load.

## Use

1. Set **READY predefinito** for new actors. **Applica a tutti** updates existing actors too and replaces their individual READY values; you can then change any actor's READY separately. Add actors and enter names and task durations in minutes. A zero duration skips a department.
2. Open **Professionisti** when crew configuration needs changing. With no professionals in a department, its capacity is free: different actors may work in it simultaneously. Add professionals to impose individual capacity limits. The same actor can never do two tasks at once.
3. Generate the schedule. Each actor must finish before READY, on the same day.
4. Use **Regole avanzate globali** for common rules; actor **Avanzate** controls priority and exceptions. **Preferisci** allows alternatives; **Richiedi** is mandatory. With no professional rule, any available professional can be selected.
5. Drag or resize a timeline task to edit it manually; changing professional within its own department is allowed. Conflicts remain visible in red and in the diagnostics list. Generate explicitly to replace manual edits with an automatic schedule.
6. Export XLS saves an `.xlsx` project. Edit names, READY times, priorities and department durations in the visible `Actors` sheet, then import the file to apply them. Keep the hidden `ID` column and hidden sheets intact. You can add rows with an empty ID or delete actor rows. Changes to READY, priorities, durations or row order clear the saved schedule; generate it again after import. Advanced rules and manual schedules remain in the hidden project data. Import also accepts legacy `.xls`/`.xlsx`. Data is held in memory: export before closing or reloading.

The normal row contains only Actor, READY, three durations and an Advanced disclosure. Actor exceptions are indicated without exposing their controls. Removing a global rule or disabling it for an actor is explicit; adding an actor rule does not erase other inherited rules.

## Scheduling behavior

The existing READY-anchored search is retained: estimate arrival from total task duration, round to five minutes, try candidate task orders and search backwards for professional availability. Retry earlier estimates up to the existing 48 additional five-minute attempts. Actors are considered by priority (lower first), then READY, then input order. Candidate ordering and professional selection have deterministic tie breaks independent of random IDs.

**Correction requested during review:** compare feasible candidate arrivals before accepting an order that requires an earlier call. Prefer the latest actual arrival; at equal arrival, retain preference ranking and deterministic enumeration. This allows Mario and Luigi to arrive together, alternate Makeup/Hair and share free-capacity Costume. A required complete order still forbids incompatible alternation. This is a documented behavior change from the legacy first-feasible-order policy; it also applies to imported projects.

Example, one makeup artist, one hairdresser, free Costume, 15 minutes each, READY 10:00, required Costume last:

| Actor | Arrival | Makeup | Hair | Costume |
| --- | --- | --- | --- | --- |
| Mario | 09:15 | 09:15–09:30 | 09:30–09:45 | 09:45–10:00 |
| Luigi | 09:15 | 09:30–09:45 | 09:15–09:30 | 09:45–10:00 |

This is a bounded sequential scheduler, not a global optimizer. It does not reconsider already accepted actors or exhaustively search every possible gap arrangement. A failure means no solution was found by this bounded search, not a proof that no conceivable schedule exists.

## Tests

`npm test` uses Node's built-in test runner, with no packages. Coverage includes legacy characterization, time boundaries, scheduling, availability purity, actor/professional conflicts, arrivals, priorities, professional preference/requirement, rule inheritance/overrides, partial and complete orders, contradictions, IDs, XLS row migration, large metadata, timeline listener lifecycle, manual edits and UI bindings.

An optional actual workbook check uses the same SheetJS distribution as the page:

```sh
curl -fsSL https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js -o /tmp/flashSCHM-xlsx.cjs
node tests/workbook-check.js /tmp/flashSCHM-xlsx.cjs
```

It checks versioned XLSX round trips, hidden metadata, actor edits, metadata exceeding one Excel cell, and legacy XLSX/XLS (BIFF8) imports. The normal unit tests do not access the network.

## Documentation

- [Roadmap](docs/ROADMAP.md)
- [Architecture and extension points](docs/ARCHITECTURE.md)
- [Rules and inheritance](docs/RULES.md)
- [Legacy migration and format details](docs/MIGRATION.md)
- [Original behavior audit](docs/BEHAVIOR.md)
- [Verification and change report](docs/REPORT.md)
