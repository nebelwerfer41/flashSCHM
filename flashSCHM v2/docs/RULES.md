# Rule model

Every rule has a stable `id`, a `type` and `strength: "preferred" | "required"`.

```js
{ id: 'makeup-before-hair', type: 'before', first: 'trucco', second: 'capelli', strength: 'required' }
{ id: 'costume-last', type: 'last', department: 'costumi', strength: 'required' }
{ id: 'preferred-sequence', type: 'order', order: ['trucco', 'capelli', 'costumi'], strength: 'preferred' }
{ id: 'makeup-person', type: 'professional', department: 'trucco', professionalId: 'stable-professional-id', strength: 'required' }
```

Supported order concepts: `before`, `after`, `first`, `last`, and complete `order`. `after` is normalized to `before`. First/last/order expand to directed edges between the actor's present tasks. An absent department does not impose an edge; a professional rule for a department without a task is irrelevant. A complete order is filtered to the tasks actually present.

Required edges must form an acyclic graph. Two required first departments, opposing before relations, or contradictory required professionals return diagnostics before placement. Soft cycles are allowed: they express competing preferences, not impossibility.

## Inheritance

Global state holds an array of rules. Actor rules hold `{add: [], disabled: []}`.

- Default: inherit all global rules.
- Add a rule: append it to `actor.rules.add`; unrelated global rules remain.
- Disable a global rule: put its ID in `actor.rules.disabled`.
- Replace a global rule through the domain API: add a rule with the same ID. The explicit resolver removes the inherited version and uses the actor version.
- The UI exposes replacement as disabling the old global rule and adding the desired exception.

Example: required global Makeup before Hair plus required actor Costume last produces Makeup → Hair → Costume. Without the actor rule, Costume can appear in any of the three positions consistent with Makeup before Hair.

## Selection and scoring

Required constraints determine validity; they never become large preference penalties. Candidates are filtered before availability search and checked again against the resulting chronological schedule.

Preferred partial relations contribute one penalty per violated normalized edge. Preferred complete orders use weighted positions, preserving the default legacy department priority ranking and ties. Imported nonstandard numeric priorities retain their original weights in `legacyWeights`; new UI rules use semantic orders. Equal scores retain permutation enumeration order: canonical Makeup/Hair/Costume recursion.

Within the initial READY-anchored placement, the feasible schedule with the latest actual arrival is chosen first. A bounded global reconsideration can then change earlier actors' assignments. Its strict first criterion is the latest possible start of the earliest activity in the whole plan. At the same opening, it minimizes `READY - first activity - total task duration`, weighted by inverse actor priority; remaining ties favor department order preferences. A search budget preserves responsiveness, so failure to improve does not prove global optimality. Hard requirements remain absolute.

Professional selection first restricts to required IDs, if present. Otherwise it prefers available professionals matching the most preferred rules, with configured professional order breaking ties. A preference may fall back at the same slot. A requirement searches earlier for that professional and never falls back. A missing required ID fails, even in a free-capacity department.

Diagnostics carry codes and IDs, not final Italian messages. Examples include `contradictory-order-constraints`, `contradictory-professional-constraints`, `required-professional-unavailable`, `cannot-finish-before-ready`, and input-validation errors. A required-professional failure describes failure under that requirement; it is not a proof that that professional alone caused infeasibility.
