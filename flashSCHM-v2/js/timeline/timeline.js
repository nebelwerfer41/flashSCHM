import { DEPARTMENTS, LABELS } from "../state.js";
import { detectConflicts, moveTask } from "../scheduling/conflicts.js";
const date = (minutes) => new Date(2023, 0, 1, 0, minutes);
const minutes = (value) => Math.round((new Date(value) - date(0)) / 60000);
const content = (text) => {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
};
/** One instance, one select subscription; refresh only replaces structured datasets. */
export function createTimeline(container, vis, getState, onchange) {
  if (!vis) {
    container.textContent =
      "Timeline non disponibile: verifica la connessione e ricarica la pagina.";
    return { render() {} };
  }
  const items = new vis.DataSet(),
    groups = new vis.DataSet();
  let selectedActor = null;
  function edit(item, callback) {
    const group = groups.get(item.group),
      original = items.get(item.id);
    if (!group || !original || group.department !== original.department) {
      callback(null);
      return;
    }
    const result = moveTask(getState(), {
      actorId: original.actorId,
      taskId: original.taskId,
      start: minutes(item.start),
      end: minutes(item.end),
      professionalId: group.professionalId,
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
      remove: false,
    },
    onMove: edit,
    onUpdate: edit,
    snap: (value) => date(Math.round(minutes(value) / 5) * 5),
    zoomMin: 3600000,
    zoomMax: 86400000,
    margin: { item: { horizontal: 0, vertical: 5 }, axis: 5 },
  });
  timeline.on("select", (properties) => {
    selectedActor = items.get(properties.items[0])?.actorId || null;
    paint();
  });
  // The same manual-edit path serves pointer gestures and keyboard controls.
  function taskContent(actor, task) {
    const node = document.createElement("button");
    node.type = "button";
    node.id = `timeline-task-${task.id}`;
    node.className = "timeline-task";
    node.textContent = `${actor.name} · ${LABELS[task.type]}`;
    node.setAttribute("aria-label", `${actor.name}, ${LABELS[task.type]}. Frecce destra/sinistra: sposta di 5 minuti. Maiusc e freccia: modifica la fine. Su/giù: cambia professionista.`);
    node.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      selectedActor = actor.id;
      if (event.key === "Enter" || event.key === " ") { paint(); return; }
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
      edit(item, () => {});
      document.getElementById(node.id)?.focus({ preventScroll: true });
    });
    return node;
  }
  function paint() {
    const state = getState(),
      conflicting = new Set(
        detectConflicts(state.actors, state.rules).flatMap((c) => c.taskIds),
      );
    items.update(
      items
        .get()
        .map((item) => ({
          id: item.id,
          className: [
            item.department,
            conflicting.has(item.id) ? "conflict" : "",
            item.actorId === selectedActor ? "highlight" : "",
          ]
            .filter(Boolean)
            .join(" "),
        })),
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
          content: content(`${LABELS[department]} · ${p.name}`),
          value: index * 10000 + i,
        });
      if (!pool.length)
        groups.add({
          id: `unassigned:${department}`,
          professionalId: null,
          department,
          content: content(LABELS[department]),
          value: index * 10000,
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
            content: content(`${LABELS[task.type]} · Non disponibile`),
            value: 99999,
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
          className: task.type,
        });
      }
    paint();
    if (fit && items.length) timeline.fit({ animation: false });
  }
  return { render, destroy: () => timeline.destroy() };
}
