(() => {
  // js/utils/ids.js
  var counter = 0;
  var session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  function newId() {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto?.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = bytes[6] & 15 | 64;
      bytes[8] = bytes[8] & 63 | 128;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `local-${session}-${++counter}`;
  }

  // js/state.js
  var DEPARTMENTS = ["trucco", "capelli", "costumi"];
  var LABELS = {
    trucco: "Trucco",
    capelli: "Capelli",
    costumi: "Costumi"
  };
  var DEFAULT_READY = 600;
  function createActor(data = {}) {
    const id = data.id || newId();
    return {
      id,
      name: "",
      ready: DEFAULT_READY,
      priority: 1,
      rules: { add: [], disabled: [] },
      schedule: [],
      ...data,
      tasks: data.tasks || DEPARTMENTS.map((type) => ({
        id: newId(),
        actorId: id,
        type,
        duration: 0
      }))
    };
  }
  function createState() {
    return {
      actors: [],
      professionals: {
        trucco: ["Fede", "Flavia"].map((name) => ({ id: newId(), name })),
        capelli: ["Ciro", "Lori"].map((name) => ({ id: newId(), name })),
        costumi: []
      },
      settings: { maxAttempts: 48, defaultReady: DEFAULT_READY },
      rules: [
        {
          id: "default-order",
          type: "order",
          order: ["costumi", "capelli", "trucco"],
          strength: "preferred"
        }
      ],
      diagnostics: [],
      savedSchedules: [],
      actorCatalog: []
    };
  }

  // js/utils/time.js
  function parseTime(value) {
    if (Number.isInteger(value) && value >= 0 && value < 1440) return value;
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value))
      throw new RangeError("invalid-time");
    const [h, m] = value.split(":").map(Number);
    if (h > 23 || m > 59) throw new RangeError("invalid-time");
    return h * 60 + m;
  }
  function formatTime(minutes2) {
    if (!Number.isInteger(minutes2) || minutes2 < 0 || minutes2 > 1440)
      throw new RangeError("invalid-time");
    return `${String(Math.floor(minutes2 / 60)).padStart(2, "0")}:${String(minutes2 % 60).padStart(2, "0")}`;
  }
  var roundToFiveMinutes = (minutes2) => Math.round(minutes2 / 5) * 5;
  var overlaps = (a, b) => a.start < b.end && b.start < a.end;
  var arrivalTime = (actor) => actor.schedule?.length ? Math.min(...actor.schedule.map((t) => t.start)) : actor.ready;

  // js/scheduling/rules.js
  function resolveRules(globalRules = [], actorRules = {}, availableTasks = DEPARTMENTS) {
    const types = new Set(
      availableTasks.map((t) => typeof t === "string" ? t : t.type)
    );
    const added = actorRules.add || [], disabled = new Set(actorRules.disabled || []);
    const replaced = new Set(added.map((r) => r.id));
    return [
      ...globalRules.filter((r) => !disabled.has(r.id) && !replaced.has(r.id)),
      ...added
    ].filter((r) => r.type === "professional" ? types.has(r.department) : true).map((r) => normalizeRule(r, types));
  }
  function normalizeRule(rule, types) {
    const r = { ...rule };
    if (r.type === "after") {
      r.type = "before";
      [r.first, r.second] = [r.second, r.first];
    }
    let edges = [];
    if (r.type === "before") edges = [[r.first, r.second]];
    if (r.type === "first")
      edges = [...types].filter((t) => t !== r.department).map((t) => [r.department, t]);
    if (r.type === "last")
      edges = [...types].filter((t) => t !== r.department).map((t) => [t, r.department]);
    if (r.type === "order") {
      r.order = (r.order || []).filter((t) => types.has(t));
      edges = r.order.flatMap((a, i) => r.order.slice(i + 1).map((b) => [a, b]));
    }
    return {
      ...r,
      edges: edges.filter(([a, b]) => types.has(a) && types.has(b))
    };
  }
  function validateRuleConsistency(rules, types) {
    const diagnostics = [];
    const allowed = /* @__PURE__ */ new Set(["before", "first", "last", "order", "professional"]);
    for (const r of rules) {
      if (!allowed.has(r.type) || !["required", "preferred"].includes(r.strength) || r.type === "before" && (![r.first, r.second].every((t) => DEPARTMENTS.includes(t)) || r.first === r.second) || ["first", "last", "professional"].includes(r.type) && !DEPARTMENTS.includes(r.department) || r.type === "order" && (!Array.isArray(r.order) || new Set(r.order).size !== r.order.length) || r.type === "professional" && !r.professionalId)
        diagnostics.push({ type: "invalid-rule", ruleId: r.id });
    }
    const edges = rules.filter((r) => r.strength === "required").flatMap((r) => r.edges);
    const visiting = /* @__PURE__ */ new Set(), done = /* @__PURE__ */ new Set();
    const cycle = (node) => {
      if (visiting.has(node)) return true;
      if (done.has(node)) return false;
      visiting.add(node);
      if (edges.filter(([a]) => a === node).some(([, b]) => cycle(b)))
        return true;
      visiting.delete(node);
      done.add(node);
      return false;
    };
    if (types.some((t) => cycle(t)))
      diagnostics.push({
        type: "contradictory-order-constraints",
        rules: rules.filter((r) => r.strength === "required" && r.edges.length).map((r) => r.id)
      });
    for (const department of types) {
      const ids = new Set(
        rules.filter(
          (r) => r.type === "professional" && r.strength === "required" && r.department === department
        ).map((r) => r.professionalId)
      );
      if (ids.size > 1)
        diagnostics.push({
          type: "contradictory-professional-constraints",
          department
        });
    }
    return { valid: diagnostics.length === 0, diagnostics };
  }
  function validateCandidate(order, rules) {
    const positions = new Map(
      order.map((t, i) => [typeof t === "string" ? t : t.type, i])
    );
    const violations = rules.filter(
      (r) => r.strength === "required" && r.edges.some(([a, b]) => positions.get(a) >= positions.get(b))
    );
    return { valid: violations.length === 0, violations };
  }
  function scoreCandidate(order, rules) {
    const types = order.map((t) => typeof t === "string" ? t : t.type);
    return rules.filter((r) => r.strength === "preferred").reduce((score, r) => {
      if (r.type === "order" && r.legacyWeights)
        return score + types.reduce(
          (sum, t, i) => sum + (r.legacyWeights[t] || 99) * (i + 1),
          0
        );
      if (r.type === "order")
        return score + types.reduce(
          (sum, t, i) => sum + Math.max(0, r.order.indexOf(t)) * (types.length - i),
          0
        );
      return score + r.edges.filter(([a, b]) => types.indexOf(a) > types.indexOf(b)).length;
    }, 0);
  }
  function generateTaskPermutations(tasks) {
    if (tasks.length <= 1) return [tasks.slice()];
    return tasks.flatMap(
      (task, i) => generateTaskPermutations(tasks.filter((_, j) => j !== i)).map((rest) => [
        task,
        ...rest
      ])
    );
  }
  function candidateOrders(tasks, rules) {
    return generateTaskPermutations(tasks).map((order, index) => ({
      order,
      index,
      score: scoreCandidate(order, rules)
    })).filter((c) => validateCandidate(c.order, rules).valid).sort((a, b) => a.score - b.score || a.index - b.index).map((c) => c.order);
  }

  // js/scheduling/professionals.js
  function isProfessionalAvailable(professional, start, end, reservations) {
    return !(reservations[professional.id] || []).some(
      (slot) => overlaps({ start, end }, slot)
    );
  }
  function findAvailableProfessionals(professionals, start, end, reservations) {
    return professionals.filter(
      (p) => isProfessionalAvailable(p, start, end, reservations)
    );
  }
  function selectProfessional(available, rules, department) {
    const relevant = rules.filter(
      (r) => r.type === "professional" && r.department === department
    );
    const required = relevant.find((r) => r.strength === "required");
    if (required)
      return available.find((p) => p.id === required.professionalId) || null;
    const preferred = relevant.filter((r) => r.strength === "preferred");
    return available.map((p, index) => ({
      p,
      index,
      score: preferred.filter((r) => r.professionalId === p.id).length
    })).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.p || null;
  }
  function reserveProfessional(reservations, task) {
    var _a;
    if (task.professionalId)
      (reservations[_a = task.professionalId] || (reservations[_a] = [])).push({ ...task });
  }

  // js/scheduling/scheduler.js
  function scheduleCandidate(actor, order, arrival, professionals, reservations, rules) {
    let cursor = arrival;
    const schedule = [];
    for (const task of order) {
      let chosen = null;
      const pool = professionals[task.type] || [];
      const required = rules.some(
        (r) => r.type === "professional" && r.department === task.type && r.strength === "required"
      );
      for (let start = cursor; start >= 0 && start <= actor.ready; start = roundToFiveMinutes(start - 5)) {
        const end = start + task.duration;
        if (end > actor.ready) continue;
        const professional = selectProfessional(
          findAvailableProfessionals(pool, start, end, reservations),
          rules,
          task.type
        );
        if ((pool.length || required) && !professional) continue;
        chosen = {
          ...task,
          actorId: actor.id,
          start,
          end,
          professionalId: professional?.id || null
        };
        break;
      }
      if (!chosen || schedule.some((t) => overlaps(t, chosen))) return null;
      schedule.push(chosen);
      cursor = chosen.end;
    }
    if (!validateCandidate(
      [...schedule].sort((a, b) => a.start - b.start),
      rules
    ).valid)
      return null;
    return schedule;
  }
  function generateSchedule({
    actors,
    professionals,
    rules = [],
    settings = {}
  }) {
    const professionalSchedules = {}, diagnostics = [];
    const sorted = actors.map((a, index) => ({ a, index })).sort(
      (x, y) => x.a.priority - y.a.priority || x.a.ready - y.a.ready || x.index - y.index
    );
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    const professionalIds = Object.values(professionals).flat().map((p) => p.id);
    if (new Set(professionalIds).size !== professionalIds.length || professionalIds.some((id) => !id)) {
      return {
        success: false,
        actors: actors.map((a) => ({ ...a, schedule: [], arrival: null })),
        professionalSchedules,
        diagnostics: [{ type: "invalid-professionals" }]
      };
    }
    for (const { a } of sorted) {
      const actor = { ...a, schedule: [], arrival: null };
      result.push(actor);
      const tasks = DEPARTMENTS.flatMap(
        (type) => a.tasks.filter((t) => t.type === type && t.duration > 0)
      );
      const ids = [a.id, ...a.tasks.map((t) => t.id)];
      if (ids.some((id) => !id || seen.has(id)) || new Set(ids).size !== ids.length || !a.name.trim() || !Number.isInteger(a.ready) || a.ready < 0 || a.ready >= 1440 || !Number.isInteger(a.priority) || a.priority < 1 || a.tasks.some(
        (t) => !Number.isInteger(t.duration) || t.duration < 0 || !DEPARTMENTS.includes(t.type) || t.actorId !== a.id
      ) || new Set(tasks.map((t) => t.type)).size !== tasks.length) {
        diagnostics.push({ type: "invalid-actor", actorId: a.id });
        continue;
      }
      ids.forEach((id) => seen.add(id));
      const effective = resolveRules(rules, a.rules, tasks), validation = validateRuleConsistency(
        effective,
        tasks.map((t) => t.type)
      );
      if (!validation.valid) {
        diagnostics.push(
          ...validation.diagnostics.map((d) => ({ ...d, actorId: a.id }))
        );
        continue;
      }
      const orders = candidateOrders(tasks, effective);
      const initial = roundToFiveMinutes(
        a.ready - tasks.reduce((sum, t) => sum + t.duration, 0)
      );
      for (let attempt = 0; attempt <= (settings.maxAttempts ?? 48); attempt++) {
        const arrival = initial - attempt * 5;
        if (arrival < 0 || actor.arrival !== null && arrival < actor.arrival)
          break;
        for (const order of orders) {
          const schedule = scheduleCandidate(
            a,
            order,
            arrival,
            professionals,
            professionalSchedules,
            effective
          );
          if (schedule) {
            const actualArrival = arrivalTime({ ...actor, schedule });
            if (actor.arrival === null || actualArrival > actor.arrival) {
              actor.schedule = schedule;
              actor.arrival = actualArrival;
            }
          }
        }
        if (!tasks.length) break;
      }
      if (tasks.length && !actor.schedule.length) {
        const required = effective.filter(
          (r) => r.type === "professional" && r.strength === "required"
        );
        diagnostics.push(
          ...(required.length ? required.map((r) => ({
            type: "required-professional-unavailable",
            department: r.department,
            professionalId: r.professionalId
          })) : [{ type: "cannot-finish-before-ready" }]).map((d) => ({ ...d, actorId: a.id }))
        );
      } else {
        actor.arrival = arrivalTime(actor);
        actor.schedule.forEach(
          (t) => reserveProfessional(professionalSchedules, t)
        );
      }
    }
    return {
      success: diagnostics.length === 0,
      actors: result,
      professionalSchedules,
      diagnostics
    };
  }

  // js/scheduling/conflicts.js
  function detectConflicts(actors, globalRules = []) {
    const tasks = actors.flatMap((a) => a.schedule), conflicts = [];
    for (let i = 0; i < tasks.length; i++)
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i], b = tasks[j];
        if (!overlaps(a, b)) continue;
        if (a.actorId === b.actorId)
          conflicts.push({
            type: "actor-overlap",
            actorId: a.actorId,
            taskIds: [a.id, b.id]
          });
        if (a.professionalId && a.professionalId === b.professionalId)
          conflicts.push({
            type: "professional-overlap",
            professionalId: a.professionalId,
            taskIds: [a.id, b.id]
          });
      }
    for (const actor of actors) {
      const rules = resolveRules(globalRules, actor.rules, actor.schedule);
      for (const t of actor.schedule) {
        if (t.end > actor.ready)
          conflicts.push({
            type: "after-ready",
            actorId: actor.id,
            taskIds: [t.id]
          });
        if (rules.some(
          (r) => r.type === "professional" && r.strength === "required" && r.department === t.type && r.professionalId !== t.professionalId
        ))
          conflicts.push({
            type: "required-professional-violated",
            actorId: actor.id,
            taskIds: [t.id]
          });
      }
      const validation = validateCandidate(
        [...actor.schedule].sort((a, b) => a.start - b.start),
        rules
      );
      if (!validation.valid)
        conflicts.push({
          type: "required-order-violated",
          actorId: actor.id,
          taskIds: actor.schedule.map((t) => t.id)
        });
    }
    return conflicts;
  }
  function moveTask(state, { actorId, taskId, start, end, professionalId }) {
    const actor = state.actors.find((a) => a.id === actorId), task = actor?.schedule.find((t) => t.id === taskId);
    if (!task || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end)
      return { valid: false };
    const pool = state.professionals[task.type];
    if (professionalId ? !pool.some((p) => p.id === professionalId) : pool.length > 0)
      return { valid: false };
    task.start = start;
    task.end = end;
    task.professionalId = professionalId;
    actor.arrival = arrivalTime(actor);
    return { valid: true, conflicts: detectConflicts(state.actors, state.rules) };
  }

  // js/timeline/timeline.js
  var date = (minutes2) => new Date(2023, 0, 1, 0, minutes2);
  var minutes = (value) => Math.round((new Date(value) - date(0)) / 6e4);
  var content = (text) => {
    const node = document.createElement("span");
    node.textContent = text;
    return node;
  };
  function createTimeline(container, vis, getState, onchange) {
    if (!vis) {
      container.textContent = "Timeline non disponibile: verifica la connessione e ricarica la pagina.";
      return { render() {
      } };
    }
    const items = new vis.DataSet(), groups = new vis.DataSet();
    let selectedActor = null;
    function edit(item, callback) {
      const group = groups.get(item.group), original = items.get(item.id);
      if (!group || !original || group.department !== original.department) {
        callback(null);
        return;
      }
      const result = moveTask(getState(), {
        actorId: original.actorId,
        taskId: original.taskId,
        start: minutes(item.start),
        end: minutes(item.end),
        professionalId: group.professionalId
      });
      callback(result.valid ? item : null);
      if (result.valid) onchange();
    }
    const timeline = new vis.Timeline(container, items, groups, {
      start: date(360),
      end: date(720),
      groupOrder: "value",
      editable: {
        updateTime: true,
        updateGroup: true,
        add: false,
        remove: false
      },
      onMove: edit,
      onUpdate: edit,
      snap: (value) => date(Math.round(minutes(value) / 5) * 5),
      zoomMin: 36e5,
      zoomMax: 864e5,
      margin: { item: { horizontal: 0, vertical: 5 }, axis: 5 }
    });
    timeline.on("select", (properties) => {
      selectedActor = items.get(properties.items[0])?.actorId || null;
      paint();
    });
    function taskContent(actor, task) {
      const node = document.createElement("button");
      node.type = "button";
      node.id = `timeline-task-${task.id}`;
      node.className = "timeline-task";
      node.textContent = `${actor.name} \xB7 ${LABELS[task.type]}`;
      node.setAttribute("aria-label", `${actor.name}, ${LABELS[task.type]}. Frecce destra/sinistra: sposta di 5 minuti. Maiusc e freccia: modifica la fine. Su/gi\xF9: cambia professionista.`);
      node.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        selectedActor = actor.id;
        if (event.key === "Enter" || event.key === " ") {
          paint();
          return;
        }
        const item = { ...items.get(task.id) };
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const delta = event.key === "ArrowRight" ? 5 : -5;
          item.end = date(minutes(item.end) + delta);
          if (!event.shiftKey) item.start = date(minutes(item.start) + delta);
        } else {
          const peers = groups.get().filter((g) => g.department === task.type);
          const index = peers.findIndex((g) => g.id === item.group);
          const target = peers[index + (event.key === "ArrowDown" ? 1 : -1)];
          if (!target) return;
          item.group = target.id;
        }
        edit(item, () => {
        });
        document.getElementById(node.id)?.focus({ preventScroll: true });
      });
      return node;
    }
    function paint() {
      const state = getState(), conflicting = new Set(
        detectConflicts(state.actors, state.rules).flatMap((c) => c.taskIds)
      );
      items.update(
        items.get().map((item) => ({
          id: item.id,
          className: [
            item.department,
            conflicting.has(item.id) ? "conflict" : "",
            item.actorId === selectedActor ? "highlight" : ""
          ].filter(Boolean).join(" ")
        }))
      );
    }
    function render(fit = false) {
      const state = getState();
      groups.clear();
      items.clear();
      for (const [index, department] of DEPARTMENTS.entries()) {
        const pool = state.professionals[department];
        for (const [i, p] of pool.entries())
          groups.add({
            id: p.id,
            professionalId: p.id,
            department,
            content: content(`${LABELS[department]} \xB7 ${p.name}`),
            value: index * 1e4 + i
          });
        if (!pool.length)
          groups.add({
            id: `unassigned:${department}`,
            professionalId: null,
            department,
            content: content(LABELS[department]),
            value: index * 1e4
          });
      }
      for (const actor of state.actors)
        for (const task of actor.schedule) {
          let group = task.professionalId || `unassigned:${task.type}`;
          if (!groups.get(group))
            groups.add({
              id: group,
              department: task.type,
              professionalId: task.professionalId,
              content: content(`${LABELS[task.type]} \xB7 Non disponibile`),
              value: 99999
            });
          items.add({
            id: task.id,
            taskId: task.id,
            actorId: actor.id,
            department: task.type,
            professionalId: task.professionalId,
            group,
            start: date(task.start),
            end: date(task.end),
            content: taskContent(actor, task),
            className: task.type
          });
        }
      paint();
      if (fit && items.length) timeline.fit({ animation: false });
    }
    return { render, destroy: () => timeline.destroy() };
  }

  // js/catalog.js
  var CATALOG_COLUMNS = [
    "ID",
    "Nome",
    "DurataTrucco",
    "DurataCapelli",
    "DurataCostumi"
  ];
  var DURATION_COLUMNS = {
    trucco: "DurataTrucco",
    capelli: "DurataCapelli",
    costumi: "DurataCostumi"
  };
  function validateCatalog(catalog) {
    if (!Array.isArray(catalog)) throw new Error("catalogo non valido");
    const seen = /* @__PURE__ */ new Set();
    for (const entry of catalog) {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim() || seen.has(entry.id) || typeof entry.name !== "string" || !entry.name.trim() || !entry.durations || DEPARTMENTS.some(
        (type) => !Number.isInteger(entry.durations[type]) || entry.durations[type] < 0
      )) throw new Error("catalogo non valido: ID, nome o durate mancanti o duplicati");
      seen.add(entry.id);
    }
  }
  function parseCatalogRows(rows) {
    if (!Array.isArray(rows)) throw new Error("Scheda Catalogo mancante.");
    const seen = /* @__PURE__ */ new Set();
    const entries = rows.filter((row) => CATALOG_COLUMNS.some((column) => String(row[column] ?? "").trim())).map((row, index) => {
      const line = Number.isInteger(row.__rowNum__) ? row.__rowNum__ + 1 : index + 2;
      const id = String(row.ID ?? "").trim();
      const name = String(row.Nome ?? "").trim();
      if (!id || !name) throw new Error(`Catalogo, riga ${line}: ID e Nome obbligatori.`);
      if (seen.has(id)) throw new Error(`Catalogo, riga ${line}: ID duplicato.`);
      seen.add(id);
      const durations = {};
      for (const type of DEPARTMENTS) {
        const column = DURATION_COLUMNS[type];
        const value = row[column];
        const number = value === "" || value == null ? 0 : Number(value);
        if (!Number.isInteger(number) || number < 0)
          throw new Error(`Catalogo, riga ${line}: ${column} non valido.`);
        durations[type] = number;
      }
      return { id, name, durations };
    });
    validateCatalog(entries);
    return entries;
  }
  function serializeCatalogRows(catalog) {
    validateCatalog(catalog);
    return catalog.map((entry) => ({
      ID: entry.id,
      Nome: entry.name,
      ...Object.fromEntries(DEPARTMENTS.map((type) => [
        DURATION_COLUMNS[type],
        entry.durations[type]
      ]))
    }));
  }
  function catalogImportPreview(catalog, incoming) {
    validateCatalog(catalog);
    validateCatalog(incoming);
    const existing = new Map(catalog.map((entry) => [entry.id, entry]));
    return incoming.map((entry) => ({
      ...entry,
      status: existing.has(entry.id) ? "existing" : "new"
    }));
  }
  function applyCatalogImport(catalog, incoming, duplicateAction) {
    const preview = catalogImportPreview(catalog, incoming);
    if (preview.some((entry) => entry.status === "existing") && !["replace", "keep"].includes(duplicateAction))
      throw new Error("Scegli come gestire gli ID gi\xE0 presenti.");
    const next = catalog.map((entry) => ({ ...entry, durations: { ...entry.durations } }));
    const positions = new Map(next.map((entry, index) => [entry.id, index]));
    let added = 0, replaced = 0, kept = 0;
    for (const entry of incoming) {
      const copy2 = { ...entry, durations: { ...entry.durations } };
      if (!positions.has(entry.id)) {
        positions.set(entry.id, next.length);
        next.push(copy2);
        added++;
      } else if (duplicateAction === "replace") {
        next[positions.get(entry.id)] = copy2;
        replaced++;
      } else kept++;
    }
    return { catalog: next, added, replaced, kept };
  }
  function addCatalogActorsToPlan(state, ids) {
    const selected = new Set(ids);
    if (selected.size !== ids.length || !selected.size)
      throw new Error("Seleziona almeno un attore del catalogo.");
    const chosen = Array.from(selected, (id) => state.actorCatalog.find((entry) => entry.id === id));
    if (chosen.some((entry) => !entry)) throw new Error("Attore del catalogo non trovato.");
    if (chosen.some((entry) => state.actors.some((actor) => actor.catalogId === entry.id)))
      throw new Error("Un attore selezionato \xE8 gi\xE0 nel piano.");
    const actors = chosen.map((entry) => {
      const actor = createActor({
        name: entry.name,
        ready: state.settings.defaultReady,
        catalogId: entry.id
      });
      for (const task of actor.tasks) task.duration = entry.durations[task.type];
      return actor;
    });
    state.actors.push(...actors);
    return actors;
  }
  function readCatalogWorkbook(XLSX, buffer) {
    const workbook = XLSX.read(buffer, { type: "array" });
    if (!workbook.Sheets.Catalogo) throw new Error("Scheda Catalogo mancante.");
    const header = XLSX.utils.sheet_to_json(workbook.Sheets.Catalogo, { header: 1 })[0] || [];
    if (!CATALOG_COLUMNS.every((column) => header.includes(column)))
      throw new Error(`Catalogo: intestazioni richieste ${CATALOG_COLUMNS.join(", ")}.`);
    return parseCatalogRows(XLSX.utils.sheet_to_json(workbook.Sheets.Catalogo, { defval: "" }));
  }
  function writeCatalogWorkbook(XLSX, catalog) {
    const rows = serializeCatalogRows(catalog);
    const workbook = XLSX.utils.book_new();
    const sheet = rows.length ? XLSX.utils.json_to_sheet(rows, { header: CATALOG_COLUMNS }) : XLSX.utils.aoa_to_sheet([CATALOG_COLUMNS]);
    sheet["!cols"] = [{ wch: 38 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    if (rows.length) sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(workbook, sheet, "Catalogo");
    return workbook;
  }

  // js/io/xlsx.js
  var durationColumns = {
    trucco: "DurataTrucco",
    capelli: "DurataCapelli",
    costumi: "DurataCostumi"
  };
  var professionalColumns = {
    trucco: "ProfessionistaTrucco",
    capelli: "ProfessionistaCapelli"
  };
  function importedTime(value) {
    if (typeof value === "number" && value >= 0 && value < 1)
      return Math.round(value * 1440) % 1440;
    return parseTime(String(value));
  }
  var actorColumns = [
    "ID",
    "Nome",
    "OrarioPronti",
    "PrioritaAttore",
    "DurataTrucco",
    "DurataCapelli",
    "DurataCostumi"
  ];
  var scheduleColumns = [
    "IDVersione",
    "Versione",
    "SalvataIl",
    "IDAttore",
    "Attore",
    "READY",
    "Arrivo",
    "Reparto",
    "Inizio",
    "Fine",
    "Professionista"
  ];
  function editableInteger(value, fallback, minimum, label, rowNumber) {
    if (value === "" || value === void 0 || value === null) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum)
      throw new Error(`Actors, riga ${rowNumber}: ${label} non valido.`);
    return number;
  }
  function applyActorRows(state, rows) {
    if (!Array.isArray(rows)) throw new Error("missing-actors-sheet");
    const byId = new Map(state.actors.map((actor) => [actor.id, actor]));
    const seen = /* @__PURE__ */ new Set();
    let scheduleChanged = false;
    const actors = rows.filter((row) => actorColumns.some((column) => String(row[column] ?? "").trim())).map((row, index) => {
      const rowNumber = Number.isInteger(row.__rowNum__) ? row.__rowNum__ + 1 : index + 2;
      const id = String(row.ID ?? "").trim();
      if (id && (!byId.has(id) || seen.has(id)))
        throw new Error(`Actors, riga ${rowNumber}: ID attore sconosciuto o duplicato.`);
      if (id) seen.add(id);
      const actor = id ? byId.get(id) : createActor({ ready: state.settings.defaultReady });
      let ready;
      try {
        ready = !id && (row.OrarioPronti === "" || row.OrarioPronti == null) ? actor.ready : importedTime(row.OrarioPronti);
      } catch {
        throw new Error(`Actors, riga ${rowNumber}: OrarioPronti non valido.`);
      }
      const priority = editableInteger(
        row.PrioritaAttore,
        1,
        1,
        "PrioritaAttore",
        rowNumber
      );
      const durations = Object.fromEntries(
        DEPARTMENTS.map((type) => [
          type,
          editableInteger(
            row[durationColumns[type]],
            0,
            0,
            durationColumns[type],
            rowNumber
          )
        ])
      );
      if (!id || actor.ready !== ready || actor.priority !== priority || actor.tasks.some((task) => task.duration !== durations[task.type]))
        scheduleChanged = true;
      actor.name = String(row.Nome ?? "");
      actor.ready = ready;
      actor.priority = priority;
      for (const task of actor.tasks) task.duration = durations[task.type];
      return actor;
    });
    if (actors.length !== state.actors.length || actors.some((actor, index) => actor.id !== state.actors[index].id))
      scheduleChanged = true;
    state.actors = actors;
    if (scheduleChanged) {
      for (const actor of actors) {
        actor.schedule = [];
        actor.arrival = null;
      }
      state.diagnostics = [];
    }
    return state;
  }
  function parseRows({ Actors, Depts = [], FlashSCHM = [] }) {
    var _a;
    if (FlashSCHM.length) {
      const version = Number(FlashSCHM[0].Version);
      if (![2, 3, 4, 5].includes(version))
        throw new Error("unsupported-file-version");
      const state2 = JSON.parse(FlashSCHM.map((row) => row.Data).join(""));
      validateProject(state2);
      (_a = state2.settings).defaultReady ?? (_a.defaultReady = DEFAULT_READY);
      state2.savedSchedules ?? (state2.savedSchedules = []);
      state2.actorCatalog ?? (state2.actorCatalog = []);
      if (version >= 3 || version === 2 && Actors) {
        let editableRows = Actors;
        if (version === 2) {
          if (Actors.length !== state2.actors.length)
            throw new Error("Per aggiungere o eliminare attori, riesporta il progetto con questa versione dell\u2019app.");
          const namePositions = /* @__PURE__ */ new Map();
          for (const [index, actor] of state2.actors.entries()) {
            if (namePositions.has(actor.name)) namePositions.set(actor.name, null);
            else namePositions.set(actor.name, index);
          }
          if (Actors.some(
            (row, index) => namePositions.has(String(row.Nome ?? "")) && namePositions.get(String(row.Nome ?? "")) !== null && namePositions.get(String(row.Nome ?? "")) !== index
          ))
            throw new Error("Per riordinare gli attori, riesporta il progetto con questa versione dell\u2019app.");
          editableRows = Actors.map((row, index) => ({
            ...row,
            ID: state2.actors[index].id
          }));
        }
        applyActorRows(state2, editableRows);
        validateProject(state2);
      }
      return state2;
    }
    const state = createState(), priorities = { trucco: 1, capelli: 2, costumi: 3 };
    for (const row of Depts) {
      const type = String(row.Reparto).toLowerCase();
      if (!DEPARTMENTS.includes(type)) continue;
      const count = Number(row.NumeroProfessionisti);
      if (!Number.isInteger(count) || count < 0 || count > 1e3)
        throw new Error("invalid-professionals");
      const names = String(row.NomiProfessionisti || "").split(",").map((n) => n.trim()).filter(Boolean);
      state.professionals[type] = Array.from({ length: count }, (_, i) => ({
        id: newId(),
        name: names[i] || `${type[0].toUpperCase()} ${i + 1}`
      }));
      priorities[type] = Number(row.Priorita) || 3;
    }
    if (new Set(Object.values(priorities)).size < 3)
      Object.assign(priorities, { trucco: 1, capelli: 2, costumi: 3 });
    state.rules = [
      {
        id: "legacy-order",
        type: "order",
        order: DEPARTMENTS.slice().sort((a, b) => priorities[b] - priorities[a]),
        strength: "preferred",
        legacyWeights: priorities
      }
    ];
    for (const row of Actors || []) {
      const actor = createActor({
        name: String(row.Nome || ""),
        ready: importedTime(row.OrarioPronti),
        priority: Number(row.PrioritaAttore) || 1
      });
      for (const task of actor.tasks)
        task.duration = Number(row[durationColumns[task.type]]) || 0;
      for (const [department, column] of Object.entries(professionalColumns)) {
        const value = row[column];
        if (value !== void 0 && value !== null && String(value) !== "") {
          const index = Number(value), professional = state.professionals[department][index];
          actor.rules.add.push({
            id: newId(),
            type: "professional",
            department,
            strength: "required",
            professionalId: professional?.id || `missing-${department}-${value}`
          });
        }
      }
      state.actors.push(actor);
    }
    validateProject(state);
    return state;
  }
  function serializeRows(state) {
    validateProject(state);
    const order = state.rules.find(
      (r) => r.type === "order" && r.strength === "preferred"
    );
    return {
      Actors: state.actors.map((a) => {
        const row = {
          ID: a.id,
          Nome: a.name,
          OrarioPronti: formatTime(a.ready),
          PrioritaAttore: a.priority
        };
        for (const type of DEPARTMENTS)
          row[durationColumns[type]] = a.tasks.find((t) => t.type === type)?.duration || 0;
        return row;
      }),
      Programmazioni: state.savedSchedules.flatMap(
        (version) => version.plan.actors.flatMap(
          (actor) => actor.schedule.map((task) => ({
            IDVersione: version.id,
            Versione: version.name,
            SalvataIl: version.savedAt,
            IDAttore: actor.id,
            Attore: actor.name,
            READY: formatTime(actor.ready),
            Arrivo: actor.arrival == null ? "" : formatTime(actor.arrival),
            Reparto: task.type,
            Inizio: formatTime(task.start),
            Fine: formatTime(task.end),
            Professionista: version.plan.professionals[task.type].find(
              (professional) => professional.id === task.professionalId
            )?.name || ""
          }))
        )
      ),
      Depts: DEPARTMENTS.map((type) => ({
        Reparto: type,
        NumeroProfessionisti: state.professionals[type].length,
        NomiProfessionisti: state.professionals[type].map((p) => p.name).join(", "),
        Priorita: order?.legacyWeights?.[type] || (order ? 3 - order.order.indexOf(type) : DEPARTMENTS.indexOf(type) + 1)
      })),
      FlashSCHM: (JSON.stringify(state).match(/[\s\S]{1,30000}/g) || []).map(
        (Data) => ({ Version: 5, Data })
      )
    };
  }
  function validateProject(state) {
    if (!state || !Array.isArray(state.actors) || !Array.isArray(state.rules) || !state.professionals || !state.settings || state.settings.defaultReady !== void 0 && (!Number.isInteger(state.settings.defaultReady) || state.settings.defaultReady < 0 || state.settings.defaultReady >= 1440))
      throw new Error("invalid-project");
    if (state.actorCatalog !== void 0) validateCatalog(state.actorCatalog);
    const ids = /* @__PURE__ */ new Set();
    const identify = (id) => {
      if (typeof id !== "string" || !id || ids.has(id))
        throw new Error("duplicate-or-missing-id");
      ids.add(id);
    };
    for (const type of DEPARTMENTS) {
      if (!Array.isArray(state.professionals[type]))
        throw new Error("invalid-professionals");
      for (const p of state.professionals[type]) {
        identify(p.id);
        if (typeof p.name !== "string") throw new Error("invalid-professionals");
      }
    }
    const checkRules = (rules) => {
      if (!Array.isArray(rules)) throw new Error("invalid-rule");
      const ruleIds = /* @__PURE__ */ new Set();
      for (const r of rules) {
        if (!r || typeof r.id !== "string" || !r.id || ruleIds.has(r.id) || !["required", "preferred"].includes(r.strength) || !["before", "after", "first", "last", "order", "professional"].includes(
          r.type
        ))
          throw new Error("invalid-rule");
        ruleIds.add(r.id);
        if (["before", "after"].includes(r.type) && (!DEPARTMENTS.includes(r.first) || !DEPARTMENTS.includes(r.second)))
          throw new Error("invalid-rule");
        if (["first", "last", "professional"].includes(r.type) && !DEPARTMENTS.includes(r.department))
          throw new Error("invalid-rule");
        if (r.type === "professional" && typeof r.professionalId !== "string")
          throw new Error("invalid-rule");
        if (r.type === "order" && (!Array.isArray(r.order) || r.order.some((t) => !DEPARTMENTS.includes(t)) || new Set(r.order).size !== r.order.length))
          throw new Error("invalid-rule");
      }
    };
    checkRules(state.rules);
    for (const a of state.actors) {
      identify(a.id);
      if (typeof a.name !== "string" || !Number.isInteger(a.ready) || a.ready < 0 || a.ready >= 1440 || !Number.isInteger(a.priority) || a.priority < 1 || !Array.isArray(a.tasks) || !Array.isArray(a.schedule) || !a.rules || !Array.isArray(a.rules.disabled) || a.catalogId !== void 0 && (typeof a.catalogId !== "string" || !a.catalogId))
        throw new Error("invalid-actor");
      checkRules(a.rules.add);
      for (const t of a.tasks) {
        identify(t.id);
        if (t.actorId !== a.id || !DEPARTMENTS.includes(t.type) || !Number.isInteger(t.duration) || t.duration < 0)
          throw new Error("invalid-task");
      }
      const scheduled = /* @__PURE__ */ new Set();
      for (const t of a.schedule) {
        if (scheduled.has(t.id) || !a.tasks.some(
          (source) => source.id === t.id && source.type === t.type
        ) || t.actorId !== a.id || !Number.isInteger(t.start) || !Number.isInteger(t.end) || t.start < 0 || t.end > 1440 || t.start >= t.end)
          throw new Error("invalid-schedule");
        scheduled.add(t.id);
      }
    }
    if (state.savedSchedules !== void 0) {
      if (!Array.isArray(state.savedSchedules)) throw new Error("invalid-saved-schedules");
      const versionIds = /* @__PURE__ */ new Set();
      for (const version of state.savedSchedules) {
        if (!version || typeof version.id !== "string" || !version.id || versionIds.has(version.id) || typeof version.name !== "string" || !version.name.trim() || typeof version.savedAt !== "string" || !Number.isFinite(Date.parse(version.savedAt)) || !version.plan || Object.hasOwn(version.plan, "savedSchedules")) throw new Error("invalid-saved-schedules");
        versionIds.add(version.id);
        validateProject(version.plan);
      }
    }
  }
  function readWorkbook(XLSX, buffer) {
    const workbook = XLSX.read(buffer, { type: "array" }), rows = {};
    if (!workbook.Sheets.Actors && !workbook.Sheets.FlashSCHM)
      throw new Error("missing-actors-sheet");
    for (const name of ["Actors", "Depts", "FlashSCHM"])
      if (workbook.Sheets[name])
        rows[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" });
    return parseRows(rows);
  }
  function writeWorkbook(XLSX, state) {
    const book = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(serializeRows(state))) {
      const sheet = (name === "Actors" || name === "Programmazioni") && rows.length === 0 ? XLSX.utils.aoa_to_sheet([name === "Actors" ? actorColumns : scheduleColumns]) : XLSX.utils.json_to_sheet(
        rows,
        name === "Actors" ? { header: actorColumns } : name === "Programmazioni" ? { header: scheduleColumns } : void 0
      );
      if (name === "Actors") {
        sheet["!cols"] = [
          { hidden: true },
          { wch: 26 },
          { wch: 17 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 }
        ];
        if (rows.length) sheet["!autofilter"] = { ref: sheet["!ref"] };
      }
      if (name === "Programmazioni") {
        sheet["!cols"] = [
          { wch: 38 },
          { wch: 24 },
          { wch: 22 },
          { wch: 38 },
          { wch: 26 },
          { wch: 10 },
          { wch: 10 },
          { wch: 14 },
          { wch: 10 },
          { wch: 10 },
          { wch: 24 }
        ];
        if (rows.length) sheet["!autofilter"] = { ref: sheet["!ref"] };
      }
      XLSX.utils.book_append_sheet(book, sheet, name);
    }
    book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }, { Hidden: 1 }] };
    return book;
  }

  // js/versions.js
  var copy = (value) => JSON.parse(JSON.stringify(value));
  function snapshotPlan(state) {
    const { savedSchedules, actorCatalog, ...plan } = state;
    return copy(plan);
  }
  function saveSchedule(state, name, savedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Inserisci un nome per la versione.");
    const version = {
      id: newId(),
      name: trimmed,
      savedAt,
      plan: snapshotPlan(state)
    };
    state.savedSchedules.push(version);
    return version;
  }
  function openSchedule(state, id) {
    const version = state.savedSchedules.find((item) => item.id === id);
    if (!version) throw new Error("Versione non trovata.");
    return {
      ...copy(version.plan),
      savedSchedules: state.savedSchedules,
      actorCatalog: state.actorCatalog
    };
  }
  function deleteSchedule(state, id) {
    const index = state.savedSchedules.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Versione non trovata.");
    state.savedSchedules.splice(index, 1);
  }

  // js/ui/dom.js
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith("on"))
        node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }
  function select(options, value, onchange) {
    const node = el(
      "select",
      {},
      ...options.map(([id, label]) => el("option", { value: id, text: label }))
    );
    node.value = value;
    node.addEventListener("change", () => onchange(node.value));
    return node;
  }
  var fieldId = 0;
  var field = (label, node) => {
    node.id || (node.id = `field-${++fieldId}`);
    return el("label", { htmlFor: node.id }, el("span", { text: label }), node);
  };
  var button = (label, onclick) => el("button", {
    type: "button",
    text: label,
    onclick,
    className: label.startsWith("Rimuovi") ? "danger" : ""
  });

  // js/ui/rules.js
  var departments = DEPARTMENTS.map((t) => [t, LABELS[t]]);
  var orderOptions = generateTaskPermutations(DEPARTMENTS).map((order) => [
    order.join(","),
    order.map((t) => LABELS[t]).join(" \u2192 ")
  ]);
  function ruleLabel(r, state) {
    const strength = r.strength === "required" ? "Richiedi" : "Preferisci";
    if (r.type === "order")
      return `${strength}: ${r.order.map((t) => LABELS[t]).join(" \u2192 ")}`;
    if (r.type === "before" || r.type === "after")
      return `${strength}: ${LABELS[r.first]} ${r.type === "before" ? "prima di" : "dopo"} ${LABELS[r.second]}`;
    if (r.type === "professional")
      return `${strength}: ${LABELS[r.department]} \u2014 ${state.professionals[r.department].find((p) => p.id === r.professionalId)?.name || "Professionista non disponibile"}`;
    return `${strength}: ${LABELS[r.department]} ${r.type === "first" ? "per primo" : "per ultimo"}`;
  }
  function renderRuleEditor(container, state, actor, onchange) {
    container.replaceChildren();
    const own = actor ? actor.rules.add : state.rules;
    if (actor && state.rules.length) {
      const inherited = el(
        "fieldset",
        {},
        el("legend", { text: "Regole globali ereditate" })
      );
      for (const r of state.rules) {
        const checkbox = el("input", {
          type: "checkbox",
          checked: !actor.rules.disabled.includes(r.id)
        });
        checkbox.addEventListener("change", () => {
          actor.rules.disabled = actor.rules.disabled.filter((id) => id !== r.id);
          if (!checkbox.checked) actor.rules.disabled.push(r.id);
          onchange();
        });
        inherited.append(field(ruleLabel(r, state), checkbox));
      }
      inherited.append(
        el("small", {
          text: "Deseleziona una regola per disattivarla per questo attore. Le regole aggiunte sotto si combinano con le altre."
        })
      );
      container.append(inherited);
    }
    for (const r of own)
      container.append(
        el(
          "div",
          { className: `rule-chip ${r.strength}` },
          el("span", { text: ruleLabel(r, state) }),
          button("Rimuovi", () => {
            own.splice(own.indexOf(r), 1);
            renderRuleEditor(container, state, actor, onchange);
            onchange();
          })
        )
      );
    const draft = {
      type: "before",
      strength: "preferred",
      first: "trucco",
      second: "capelli",
      department: "trucco",
      order: ["trucco", "capelli", "costumi"],
      professionalId: ""
    };
    const editor = el("div", { className: "rule-builder", "data-strength": "preferred" }), parameters = el("div", { className: "rule-parameters", role: "group", "aria-label": "Parametri della regola" }), feedback = el("p", { className: "rule-error", role: "status" });
    function renderParameters() {
      parameters.replaceChildren();
      if (["before", "after"].includes(draft.type)) {
        parameters.append(
          field(
            "Reparto",
            select(departments, draft.first, (v) => draft.first = v)
          ),
          field(
            draft.type === "before" ? "Prima di" : "Dopo",
            select(departments, draft.second, (v) => draft.second = v)
          )
        );
      } else if (draft.type === "order") {
        parameters.append(
          field(
            "Sequenza",
            select(
              orderOptions,
              draft.order.join(","),
              (v) => draft.order = v.split(",")
            )
          )
        );
      } else {
        parameters.append(
          field(
            "Reparto",
            select(departments, draft.department, (v) => {
              draft.department = v;
              draft.professionalId = "";
              renderParameters();
            })
          )
        );
        if (draft.type === "professional") {
          const pool = state.professionals[draft.department];
          draft.professionalId = draft.professionalId || pool[0]?.id || "";
          parameters.append(
            field(
              "Professionista",
              select(
                pool.length ? pool.map((p) => [p.id, p.name]) : [["", "Nessun professionista"]],
                draft.professionalId,
                (v) => draft.professionalId = v
              )
            )
          );
        }
      }
    }
    editor.append(
      field(
        "Forza",
        select(
          [
            ["preferred", "Preferisci (con alternativa)"],
            ["required", "Richiedi (obbligatorio)"]
          ],
          draft.strength,
          (v) => {
            draft.strength = v;
            editor.setAttribute("data-strength", v);
          }
        )
      ),
      field(
        "Tipo di regola",
        select(
          [
            ["before", "Prima di"],
            ["after", "Dopo"],
            ["first", "Primo reparto"],
            ["last", "Ultimo reparto"],
            ["order", "Sequenza completa"],
            ["professional", "Professionista"]
          ],
          draft.type,
          (v) => {
            draft.type = v;
            renderParameters();
          }
        )
      ),
      parameters,
      button("Aggiungi regola", () => {
        if (["before", "after"].includes(draft.type) && draft.first === draft.second) {
          feedback.textContent = "Scegli due reparti diversi per questa regola.";
          return;
        }
        if (draft.type === "professional" && !draft.professionalId) {
          feedback.textContent = "Aggiungi prima un professionista nel reparto selezionato.";
          return;
        }
        const r = { id: newId(), type: draft.type, strength: draft.strength };
        if (["before", "after"].includes(r.type))
          Object.assign(r, { first: draft.first, second: draft.second });
        else if (r.type === "order") r.order = draft.order.slice();
        else {
          r.department = draft.department;
          if (r.type === "professional") r.professionalId = draft.professionalId;
        }
        own.push(r);
        renderRuleEditor(container, state, actor, onchange);
        onchange();
      })
    );
    editor.append(feedback);
    renderParameters();
    container.append(editor);
  }

  // js/ui/render.js
  function renderActors(container, state, changed, remove) {
    container.replaceChildren();
    if (!state.actors.length) container.append(el(
      "div",
      { className: "empty-state" },
      el("strong", { text: "Il piano di lavoro inizia dagli attori" }),
      el("p", { text: "Aggiungi il primo attore e imposta il suo orario READY." })
    ));
    for (const actor of state.actors) {
      const summary = el("summary");
      const badge = () => {
        const exceptions = actor.rules.add.length + actor.rules.disabled.length;
        summary.textContent = `Avanzate \xB7 Priorit\xE0 ${actor.priority}${exceptions ? ` \xB7 ${exceptions} eccezioni` : ""}`;
        if (summary.parentElement) summary.parentElement.classList.toggle("has-exceptions", exceptions > 0);
      };
      badge();
      const input = (label, type, value, update) => {
        const node = el("input", { type, value, "aria-label": label });
        if (type === "number") {
          node.min = 0;
          node.step = 1;
        }
        node.addEventListener("input", () => {
          try {
            update(node.value);
            node.setCustomValidity("");
            node.setAttribute("aria-invalid", "false");
            badge();
            changed();
          } catch {
            node.setCustomValidity("Valore non valido");
            node.setAttribute("aria-invalid", "true");
            node.reportValidity();
          }
        });
        return field(label, node);
      };
      const normal = el(
        "div",
        { className: "actor-main" },
        input("Attore", "text", actor.name, (v) => actor.name = v),
        input(
          "READY \xB7 pronti",
          "time",
          formatTime(actor.ready),
          (v) => actor.ready = parseTime(v)
        )
      );
      for (const type of DEPARTMENTS) {
        const durationField = input(
          `${LABELS[type]} (min)`,
          "number",
          actor.tasks.find((t) => t.type === type)?.duration || 0,
          (v) => {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 0) throw new Error();
            actor.tasks.find((t) => t.type === type).duration = n;
          }
        );
        durationField.className = `department-field department-${type}`;
        normal.append(durationField);
      }
      const editor = el("div"), advanced = el(
        "details",
        { className: "actor-advanced" },
        summary,
        input("Priorit\xE0 attore (1 = prima)", "number", actor.priority, (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) throw new Error();
          actor.priority = n;
        }),
        el("h3", { text: "Regole per questo attore" }),
        editor,
        button("Rimuovi attore", () => remove(actor.id))
      );
      renderRuleEditor(editor, state, actor, () => {
        badge();
        changed();
      });
      const row = el(
        "article",
        { className: "actor-row", "data-actor-id": actor.id },
        normal,
        advanced
      );
      badge();
      container.append(row);
    }
  }
  function renderProfessionals(container, state, changed, rerender) {
    container.replaceChildren();
    for (const type of DEPARTMENTS) {
      const section = el("section", { className: `professional-department department-${type}`, "aria-label": LABELS[type] }, el("h3", { text: LABELS[type] }));
      if (!state.professionals[type].length)
        section.append(
          el(
            "div",
            { className: "capacity-status" },
            el("strong", { text: "Capacit\xE0 libera" }),
            el("small", { text: "Attori in contemporanea, senza limite di reparto." })
          )
        );
      for (const p of state.professionals[type]) {
        const input = el("input", {
          value: p.name,
          "aria-label": `Nome professionista ${LABELS[type]}`
        });
        input.addEventListener("change", () => {
          p.name = input.value;
          changed();
        });
        section.append(
          el(
            "div",
            { className: "professional-row" },
            field("Nome professionista", input),
            button("Rimuovi", () => {
              state.professionals[type] = state.professionals[type].filter(
                (other) => other.id !== p.id
              );
              changed();
              rerender();
            })
          )
        );
      }
      container.append(section);
    }
  }
  function renderTable(body, state, { showEnd, showProfessional }) {
    body.replaceChildren();
    if (!state.actors.length) body.append(el("tr", {}, el("td", {
      colSpan: 6,
      className: "table-empty",
      text: "Nessun attore nel piano. Aggiungi gli attori per iniziare."
    })));
    for (const actor of state.actors) {
      const row = el("tr", { "data-actor-id": actor.id });
      const cells = [
        actor.name,
        actor.arrival == null ? "\u2014" : formatTime(actor.arrival)
      ];
      for (const type of DEPARTMENTS) {
        const task = actor.schedule.find((t) => t.type === type);
        let text = task ? `${formatTime(task.start)}${showEnd ? ` \u2013 ${formatTime(task.end)}` : ""}` : "\u2014";
        if (task && showProfessional)
          text += ` (${state.professionals[type].find((p) => p.id === task.professionalId)?.name || (task.professionalId ? "Non disponibile" : "Qualsiasi")})`;
        cells.push(text);
      }
      cells.push(formatTime(actor.ready));
      row.append(...cells.map((text) => el("td", { text })));
      body.append(row);
    }
  }
  var messages = {
    "invalid-actor": "Controlla nome, orario, priorit\xE0 e durate dell\u2019attore.",
    "invalid-professionals": "Configurazione dei professionisti non valida.",
    "invalid-rule": "Regola non valida.",
    "contradictory-order-constraints": "Le regole obbligatorie sull\u2019ordine sono in contraddizione.",
    "contradictory-professional-constraints": "Sono richiesti professionisti diversi per lo stesso reparto.",
    "required-professional-unavailable": "Nessuna programmazione possibile con il professionista richiesto.",
    "cannot-finish-before-ready": "Impossibile completare le attivit\xE0 prima dei Pronti nello stesso giorno.",
    "actor-overlap": "Attivit\xE0 sovrapposte per lo stesso attore.",
    "professional-overlap": "Professionista assegnato ad attivit\xE0 sovrapposte.",
    "after-ready": "Attivit\xE0 oltre l\u2019orario di Pronti.",
    "required-professional-violated": "Il professionista assegnato viola una regola obbligatoria.",
    "required-order-violated": "L\u2019ordine delle attivit\xE0 viola una regola obbligatoria."
  };
  function renderDiagnostics(container, state, conflicts, stale) {
    container.replaceChildren();
    const issues = [...state.diagnostics, ...conflicts];
    const hasSchedule = state.actors.some((a) => a.schedule.length);
    container.setAttribute("data-status", issues.length ? "error" : stale ? "warning" : hasSchedule ? "success" : "idle");
    container.append(el("strong", { text: issues.length ? `Attenzione \xB7 ${issues.length} problemi da verificare` : stale ? "Programmazione da aggiornare" : hasSchedule ? "Programmazione disponibile \xB7 nessun conflitto rilevato" : "In attesa della programmazione" }));
    if (!hasSchedule && !issues.length && !stale) container.append(el("p", { text: "Completa i dati e seleziona Genera programmazione per calcolare gli orari." }));
    if (stale)
      container.append(
        el("p", {
          text: "Dati modificati: gli orari visualizzati sono obsoleti. Genera nuovamente per aggiornarli."
        })
      );
    const list = el("ul");
    for (const d of issues) {
      const actor = state.actors.find((a) => a.id === d.actorId);
      const involved = d.taskIds ? state.actors.filter((a) => a.schedule.some((t) => d.taskIds.includes(t.id))).map((a) => a.name).join(", ") : "";
      list.append(
        el("li", {
          text: `${actor?.name || involved || "Programmazione"}: ${messages[d.type] || d.type}${d.department ? ` (${LABELS[d.department]})` : ""}`
        })
      );
    }
    if (list.childNodes.length) container.append(list);
  }

  // js/app.js
  function initApp() {
    let state = createState(), stale = false, exportPending = true;
    let pendingCatalog = null;
    const selectedCatalogIds = /* @__PURE__ */ new Set();
    const $ = (id) => document.getElementById(id);
    let timeline = { render() {
    } };
    const catalogDurations = (entry) => DEPARTMENTS.map((type) => `${LABELS[type]} ${entry.durations[type]} min`).join(" \xB7 ");
    function renderCatalogSelection() {
      $("addCatalogActors").disabled = selectedCatalogIds.size === 0;
      $("addCatalogActors").textContent = selectedCatalogIds.size ? `Aggiungi ${selectedCatalogIds.size} al piano` : "Aggiungi selezionati al piano";
    }
    function renderCatalog() {
      const query = $("catalogSearch").value.trim().toLocaleLowerCase("it-IT");
      const inPlan = new Set(state.actors.map((actor) => actor.catalogId));
      for (const id of selectedCatalogIds)
        if (!state.actorCatalog.some((entry) => entry.id === id) || inPlan.has(id))
          selectedCatalogIds.delete(id);
      const visible = state.actorCatalog.filter((entry) => `${entry.name} ${entry.id}`.toLocaleLowerCase("it-IT").includes(query));
      $("catalogCount").textContent = String(state.actorCatalog.length);
      $("catalogList").replaceChildren(...visible.map((entry) => {
        const checkbox = el("input", {
          type: "checkbox",
          checked: selectedCatalogIds.has(entry.id),
          disabled: inPlan.has(entry.id),
          "aria-label": `Seleziona ${entry.name}`
        });
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedCatalogIds.add(entry.id);
          else selectedCatalogIds.delete(entry.id);
          renderCatalogSelection();
        });
        return el(
          "li",
          {},
          el(
            "label",
            { className: "catalog-choice" },
            checkbox,
            el(
              "span",
              {},
              el("strong", { text: entry.name }),
              el("small", { text: `${entry.id} \xB7 ${catalogDurations(entry)}${inPlan.has(entry.id) ? " \xB7 Gi\xE0 nel piano" : ""}` })
            )
          )
        );
      }));
      $("catalogEmpty").hidden = visible.length > 0;
      $("catalogEmpty").textContent = state.actorCatalog.length ? "Nessun attore corrisponde alla ricerca." : "Il catalogo \xE8 vuoto. Esporta un modello XLSX, compilalo e reimportalo.";
      renderCatalogSelection();
    }
    function renderCatalogPreview() {
      $("catalogPreview").hidden = !pendingCatalog;
      if (!pendingCatalog) return;
      const preview = catalogImportPreview(state.actorCatalog, pendingCatalog);
      const duplicates = preview.filter((entry) => entry.status === "existing").length;
      $("catalogPreviewStatus").textContent = `${preview.length} schede nel file: ${preview.length - duplicates} nuove, ${duplicates} con ID gi\xE0 presente.`;
      $("catalogPreviewRows").replaceChildren(...preview.map((entry) => {
        const existing = state.actorCatalog.find((item) => item.id === entry.id);
        return el(
          "li",
          {},
          el("strong", { text: entry.name }),
          el("small", { text: `${entry.id} \xB7 ${catalogDurations(entry)} \xB7 ${entry.status === "existing" ? "ID gi\xE0 presente" : "Nuovo"}` }),
          ...existing ? [el("small", {
            text: `Nel catalogo: ${existing.name} \xB7 ${catalogDurations(existing)}`
          })] : []
        );
      }));
      $("duplicateActionLabel").hidden = duplicates === 0;
      $("applyCatalogImport").disabled = !preview.length || duplicates > 0 && !$("duplicateAction").value;
    }
    function renderExportStatus() {
      $("exportStatus").textContent = exportPending ? "Modifiche non ancora esportate. Esporta l\u2019XLSX prima di chiudere." : "Progetto esportato. Nessuna modifica da esportare.";
      $("exportStatus").setAttribute("data-pending", String(exportPending));
    }
    function markDirty() {
      exportPending = true;
      renderExportStatus();
    }
    function renderVersions() {
      $("savedSchedules").replaceChildren(
        ...state.savedSchedules.map(
          (version) => el(
            "li",
            {},
            el(
              "div",
              { className: "version-details" },
              el("strong", { text: version.name }),
              el("small", { text: new Date(version.savedAt).toLocaleString("it-IT") })
            ),
            button("Apri", () => {
              state = openSchedule(state, version.id);
              stale = false;
              markDirty();
              renderConfiguration();
              renderCatalog();
              renderSchedule(true);
              $("versionStatus").textContent = `Versione \u201C${version.name}\u201D aperta come piano modificabile.`;
            }),
            button("Elimina", () => {
              deleteSchedule(state, version.id);
              markDirty();
              renderVersions();
              $("versionStatus").textContent = `Versione \u201C${version.name}\u201D eliminata.`;
            })
          )
        )
      );
      $("versionsEmpty").hidden = state.savedSchedules.length > 0;
    }
    function renderSchedule(fit = false) {
      renderTable($("scheduleTableBody"), state, {
        showEnd: $("showStartEndCheckbox").checked,
        showProfessional: $("showProfessionalCheckbox").checked
      });
      renderDiagnostics(
        $("diagnostics"),
        state,
        detectConflicts(state.actors, state.rules),
        stale
      );
      timeline.render(fit);
    }
    function changed() {
      markDirty();
      stale = state.actors.some((a) => a.schedule.length > 0);
      state.diagnostics = [];
      renderSchedule();
    }
    function renderDefaultReady() {
      $("defaultReady").value = formatTime(
        state.settings.defaultReady ?? DEFAULT_READY
      );
      $("defaultReady").setCustomValidity("");
      $("defaultReady").setAttribute("aria-invalid", "false");
      $("readyStatus").textContent = "";
    }
    function readDefaultReady() {
      try {
        const ready = parseTime($("defaultReady").value);
        if (state.settings.defaultReady !== ready) markDirty();
        state.settings.defaultReady = ready;
        $("defaultReady").setCustomValidity("");
        $("defaultReady").setAttribute("aria-invalid", "false");
        return ready;
      } catch {
        $("defaultReady").setCustomValidity("Inserisci un orario READY valido.");
        $("defaultReady").setAttribute("aria-invalid", "true");
        $("defaultReady").reportValidity();
        return null;
      }
    }
    function renderConfiguration() {
      renderDefaultReady();
      renderProfessionals(
        $("professionalSettings"),
        state,
        changed,
        renderConfiguration
      );
      for (const [index, type] of DEPARTMENTS.entries())
        $("professionalSettings").children[index].append(
          button(`Aggiungi ${LABELS[type]}`, () => {
            state.professionals[type].push({
              id: newId(),
              name: `${LABELS[type]} ${state.professionals[type].length + 1}`
            });
            changed();
            renderConfiguration();
          })
        );
      renderRuleEditor($("globalRules"), state, null, () => {
        changed();
        renderActorRows();
      });
      renderActorRows();
    }
    function renderActorRows() {
      $("actorCount").textContent = String(state.actors.length);
      renderActors($("actorRows"), state, changed, (id) => {
        state.actors = state.actors.filter((a) => a.id !== id);
        changed();
        renderActorRows();
        renderCatalog();
      });
    }
    $("defaultReady").addEventListener("change", () => {
      if (readDefaultReady() !== null)
        $("readyStatus").textContent = "Predefinito aggiornato. Gli attori esistenti mantengono il loro READY.";
    });
    $("applyDefaultReady").addEventListener("click", () => {
      const ready = readDefaultReady();
      if (ready === null) return;
      const updated = state.actors.filter((actor) => actor.ready !== ready).length;
      for (const actor of state.actors) actor.ready = ready;
      if (updated) {
        changed();
        renderActorRows();
      }
      $("readyStatus").textContent = `READY ${formatTime(ready)} applicato a ${state.actors.length} attori.`;
    });
    $("addActor").addEventListener("click", () => {
      const ready = readDefaultReady();
      if (ready === null) return;
      state.actors.push(createActor({ ready }));
      changed();
      renderActorRows();
      $("actorRows").lastElementChild?.querySelector("input")?.focus();
    });
    $("catalogSearch").addEventListener("input", renderCatalog);
    $("duplicateAction").addEventListener("change", renderCatalogPreview);
    $("catalogImportInput").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (!globalThis.XLSX)
          throw new Error("Libreria XLS non disponibile. Verifica la connessione.");
        pendingCatalog = readCatalogWorkbook(globalThis.XLSX, await file.arrayBuffer());
        $("duplicateAction").value = "";
        renderCatalogPreview();
        $("catalogStatus").textContent = "Controlla l\u2019anteprima e applica l\u2019importazione.";
      } catch (error) {
        pendingCatalog = null;
        renderCatalogPreview();
        $("catalogStatus").textContent = `Importazione catalogo non riuscita: ${error.message}`;
      }
      event.target.value = "";
    });
    $("applyCatalogImport").addEventListener("click", () => {
      if (!pendingCatalog) return;
      try {
        const result = applyCatalogImport(
          state.actorCatalog,
          pendingCatalog,
          $("duplicateAction").value
        );
        state.actorCatalog = result.catalog;
        pendingCatalog = null;
        selectedCatalogIds.clear();
        renderCatalogPreview();
        renderCatalog();
        markDirty();
        $("catalogStatus").textContent = `Catalogo aggiornato: ${result.added} nuove, ${result.replaced} aggiornate, ${result.kept} mantenute. Esporta il catalogo XLSX per conservarlo.`;
      } catch (error) {
        $("catalogStatus").textContent = error.message;
      }
    });
    $("cancelCatalogImport").addEventListener("click", () => {
      pendingCatalog = null;
      renderCatalogPreview();
      $("catalogStatus").textContent = "Importazione catalogo annullata.";
    });
    $("catalogExport").addEventListener("click", () => {
      try {
        if (!globalThis.XLSX)
          throw new Error("Libreria XLS non disponibile. Verifica la connessione.");
        globalThis.XLSX.writeFile(
          writeCatalogWorkbook(globalThis.XLSX, state.actorCatalog),
          "flash_schm_catalogo_attori.xlsx"
        );
        $("catalogStatus").textContent = "Catalogo XLSX esportato.";
      } catch (error) {
        $("catalogStatus").textContent = `Esportazione catalogo non riuscita: ${error.message}`;
      }
    });
    $("addCatalogActors").addEventListener("click", () => {
      try {
        if (readDefaultReady() === null) return;
        const count = addCatalogActorsToPlan(state, Array.from(selectedCatalogIds)).length;
        selectedCatalogIds.clear();
        changed();
        renderActorRows();
        renderCatalog();
        $("catalogStatus").textContent = `${count} attori aggiunti al piano con il READY predefinito.`;
      } catch (error) {
        $("catalogStatus").textContent = error.message;
      }
    });
    $("generate").addEventListener("click", () => {
      if ([...document.querySelectorAll("input")].some(
        (input) => !input.reportValidity()
      ))
        return;
      const result = generateSchedule(state);
      for (const actor of state.actors) {
        const scheduled = result.actors.find((a) => a.id === actor.id);
        actor.schedule = scheduled.schedule;
        actor.arrival = scheduled.arrival;
      }
      state.diagnostics = result.diagnostics;
      stale = false;
      markDirty();
      renderSchedule(true);
    });
    $("saveSchedule").addEventListener("click", () => {
      try {
        const version = saveSchedule(state, $("versionName").value);
        $("versionName").value = "";
        markDirty();
        renderVersions();
        $("versionStatus").textContent = `Versione \u201C${version.name}\u201D salvata nel progetto. Esporta l\u2019XLSX per conservarla.`;
      } catch (error) {
        $("versionStatus").textContent = error.message;
      }
    });
    for (const id of ["showStartEndCheckbox", "showProfessionalCheckbox"])
      $(id).addEventListener("change", () => renderSchedule());
    $("export").addEventListener("click", () => {
      try {
        if (!globalThis.XLSX)
          throw new Error(
            "Libreria XLS non disponibile. Verifica la connessione."
          );
        globalThis.XLSX.writeFile(
          writeWorkbook(globalThis.XLSX, state),
          "flash_scheduler_export.xlsx",
          { cellStyles: true }
        );
        exportPending = false;
        renderExportStatus();
        $("ioStatus").setAttribute("data-status", "success");
        $("ioStatus").textContent = "Esportazione completata.";
      } catch (error) {
        $("ioStatus").setAttribute("data-status", "error");
        $("ioStatus").textContent = `Esportazione non riuscita: ${error.message}`;
      }
    });
    $("xlsImportInput").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (!globalThis.XLSX)
          throw new Error(
            "Libreria XLS non disponibile. Verifica la connessione."
          );
        const imported = readWorkbook(globalThis.XLSX, await file.arrayBuffer());
        state = imported;
        state.diagnostics || (state.diagnostics = []);
        stale = false;
        exportPending = false;
        renderConfiguration();
        renderVersions();
        selectedCatalogIds.clear();
        pendingCatalog = null;
        renderCatalogPreview();
        renderCatalog();
        renderExportStatus();
        renderSchedule(true);
        $("ioStatus").setAttribute("data-status", "success");
        $("ioStatus").textContent = "Importazione completata. Se hai modificato gli orari, genera di nuovo la programmazione.";
      } catch (error) {
        $("ioStatus").setAttribute("data-status", "error");
        $("ioStatus").textContent = `Importazione non riuscita: ${error.message}`;
      }
      event.target.value = "";
    });
    renderConfiguration();
    renderVersions();
    renderCatalog();
    renderCatalogPreview();
    renderExportStatus();
    try {
      timeline = createTimeline(
        $("visualization"),
        globalThis.vis,
        () => state,
        () => {
          markDirty();
          renderSchedule();
        }
      );
    } catch (error) {
      $("visualization").textContent = "Timeline non disponibile. Puoi continuare a usare la tabella di programmazione.";
      console.error("Timeline initialization failed", error);
    }
    renderSchedule();
    return { getState: () => state, destroy: () => timeline.destroy?.() };
  }
  initApp();
})();
