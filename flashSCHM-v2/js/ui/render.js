import { DEPARTMENTS, LABELS } from "../state.js";
import { formatTime, parseTime } from "../utils/time.js";
import { el, field, button } from "./dom.js";
import { renderRuleEditor } from "./rules.js";

export function renderActors(container, state, changed, remove) {
  container.replaceChildren();
  if (!state.actors.length) container.append(el("div", { className: "empty-state" },
    el("strong", { text: "Il piano di lavoro inizia dagli attori" }),
    el("p", { text: "Aggiungi il primo attore e imposta il suo orario READY." })));
  for (const actor of state.actors) {
    const summary = el("summary");
    const badge = () => {
      const exceptions = actor.rules.add.length + actor.rules.disabled.length;
      summary.textContent = `Avanzate · Priorità ${actor.priority}${exceptions ? ` · ${exceptions} eccezioni` : ""}`;
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
      input("Attore", "text", actor.name, (v) => (actor.name = v)),
      input(
        "READY · pronti",
        "time",
        formatTime(actor.ready),
        (v) => (actor.ready = parseTime(v)),
      ),
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
          },
        );
      durationField.className = `department-field department-${type}`;
      normal.append(durationField);
    }
    const editor = el("div"),
      advanced = el(
        "details",
        { className: "actor-advanced" },
        summary,
        input("Priorità attore (1 = prima)", "number", actor.priority, (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) throw new Error();
          actor.priority = n;
        }),
        el("h3", { text: "Regole per questo attore" }),
        editor,
        button("Rimuovi attore", () => remove(actor.id)),
      );
    renderRuleEditor(editor, state, actor, () => {
      badge();
      changed();
    });
    const row = el(
      "article",
      { className: "actor-row", "data-actor-id": actor.id },
      normal,
      advanced,
    );
    badge();
    container.append(row);
  }
}
export function renderProfessionals(container, state, changed, rerender) {
  container.replaceChildren();
  for (const type of DEPARTMENTS) {
    const section = el("section", { className: `professional-department department-${type}`, "aria-label": LABELS[type] }, el("h3", { text: LABELS[type] }));
    if (!state.professionals[type].length)
      section.append(
        el("div", { className: "capacity-status" },
          el("strong", { text: "Capacità libera" }),
          el("small", { text: "Attori in contemporanea, senza limite di reparto." })),
      );
    for (const p of state.professionals[type]) {
      const input = el("input", {
        value: p.name,
        "aria-label": `Nome professionista ${LABELS[type]}`,
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
              (other) => other.id !== p.id,
            );
            changed();
            rerender();
          }),
        ),
      );
    }
    container.append(section);
  }
}
export function renderTable(body, state, { showEnd, showProfessional }) {
  body.replaceChildren();
  if (!state.actors.length) body.append(el("tr", {}, el("td", {
    colSpan: 6, className: "table-empty", text: "Nessun attore nel piano. Aggiungi gli attori per iniziare." })));
  for (const actor of state.actors) {
    const row = el("tr", { "data-actor-id": actor.id });
    const cells = [
      actor.name,
      actor.arrival == null ? "—" : formatTime(actor.arrival),
    ];
    for (const type of DEPARTMENTS) {
      const task = actor.schedule.find((t) => t.type === type);
      let text = task
        ? `${formatTime(task.start)}${showEnd ? ` – ${formatTime(task.end)}` : ""}`
        : "—";
      if (task && showProfessional)
        text += ` (${state.professionals[type].find((p) => p.id === task.professionalId)?.name || (task.professionalId ? "Non disponibile" : "Qualsiasi")})`;
      cells.push(text);
    }
    cells.push(formatTime(actor.ready));
    row.append(...cells.map((text) => el("td", { text })));
    body.append(row);
  }
}
const messages = {
  "invalid-actor": "Controlla nome, orario, priorità e durate dell’attore.",
  "invalid-professionals": "Configurazione dei professionisti non valida.",
  "invalid-rule": "Regola non valida.",
  "contradictory-order-constraints":
    "Le regole obbligatorie sull’ordine sono in contraddizione.",
  "contradictory-professional-constraints":
    "Sono richiesti professionisti diversi per lo stesso reparto.",
  "required-professional-unavailable":
    "Nessuna programmazione possibile con il professionista richiesto.",
  "cannot-finish-before-ready":
    "Impossibile completare le attività prima dei Pronti nello stesso giorno.",
  "actor-overlap": "Attività sovrapposte per lo stesso attore.",
  "professional-overlap": "Professionista assegnato ad attività sovrapposte.",
  "after-ready": "Attività oltre l’orario di Pronti.",
  "required-professional-violated":
    "Il professionista assegnato viola una regola obbligatoria.",
  "required-order-violated":
    "L’ordine delle attività viola una regola obbligatoria.",
};
export function renderDiagnostics(container, state, conflicts, stale) {
  container.replaceChildren();
  const issues = [...state.diagnostics, ...conflicts];
  const hasSchedule = state.actors.some((a) => a.schedule.length);
  container.setAttribute("data-status", issues.length ? "error" : stale ? "warning" : hasSchedule ? "success" : "idle");
  container.append(el("strong", { text: issues.length ? `Attenzione · ${issues.length} problemi da verificare` : stale ? "Programmazione da aggiornare" : hasSchedule ? "Programmazione disponibile · nessun conflitto rilevato" : "In attesa della programmazione" }));
  if (!hasSchedule && !issues.length && !stale) container.append(el("p", { text: "Completa i dati e seleziona Genera programmazione per calcolare gli orari." }));
  if (stale)
    container.append(
      el("p", {
        text: "Dati modificati: gli orari visualizzati sono obsoleti. Genera nuovamente per aggiornarli.",
      }),
    );
  const list = el("ul");
  for (const d of issues) {
    const actor = state.actors.find((a) => a.id === d.actorId);
    const involved = d.taskIds
      ? state.actors
          .filter((a) => a.schedule.some((t) => d.taskIds.includes(t.id)))
          .map((a) => a.name)
          .join(", ")
      : "";
    list.append(
      el("li", {
        text: `${actor?.name || involved || "Programmazione"}: ${messages[d.type] || d.type}${d.department ? ` (${LABELS[d.department]})` : ""}`,
      }),
    );
  }
  if (list.childNodes.length) container.append(list);
}
