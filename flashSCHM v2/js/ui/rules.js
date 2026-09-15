import { DEPARTMENTS, LABELS, newId } from "../state.js";
import { generateTaskPermutations } from "../scheduling/rules.js";
import { el, select, field, button } from "./dom.js";
const departments = DEPARTMENTS.map((t) => [t, LABELS[t]]);
const orderOptions = generateTaskPermutations(DEPARTMENTS).map((order) => [
  order.join(","),
  order.map((t) => LABELS[t]).join(" → "),
]);
export function ruleLabel(r, state) {
  const strength = r.strength === "required" ? "Richiedi" : "Preferisci";
  if (r.type === "order")
    return `${strength}: ${r.order.map((t) => LABELS[t]).join(" → ")}`;
  if (r.type === "before" || r.type === "after")
    return `${strength}: ${LABELS[r.first]} ${r.type === "before" ? "prima di" : "dopo"} ${LABELS[r.second]}`;
  if (r.type === "professional")
    return `${strength}: ${LABELS[r.department]} — ${state.professionals[r.department].find((p) => p.id === r.professionalId)?.name || "Professionista non disponibile"}`;
  return `${strength}: ${LABELS[r.department]} ${r.type === "first" ? "per primo" : "per ultimo"}`;
}
export function renderRuleEditor(container, state, actor, onchange) {
  container.replaceChildren();
  const own = actor ? actor.rules.add : state.rules;
  if (actor && state.rules.length) {
    const inherited = el(
      "fieldset",
      {},
      el("legend", { text: "Regole globali ereditate" }),
    );
    for (const r of state.rules) {
      const checkbox = el("input", {
        type: "checkbox",
        checked: !actor.rules.disabled.includes(r.id),
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
        text: "Deseleziona una regola per disattivarla per questo attore. Le regole aggiunte sotto si combinano con le altre.",
      }),
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
        }),
      ),
    );
  const draft = {
    type: "before",
    strength: "preferred",
    first: "trucco",
    second: "capelli",
    department: "trucco",
    order: ["trucco", "capelli", "costumi"],
    professionalId: "",
  };
  const editor = el("div", { className: "rule-builder", "data-strength": "preferred" }),
    parameters = el("div", { className: "rule-parameters", role: "group", "aria-label": "Parametri della regola" }),
    feedback = el("p", { className: "rule-error", role: "status" });
  function renderParameters() {
    parameters.replaceChildren();
    if (["before", "after"].includes(draft.type)) {
      parameters.append(
        field(
          "Reparto",
          select(departments, draft.first, (v) => (draft.first = v)),
        ),
        field(
          draft.type === "before" ? "Prima di" : "Dopo",
          select(departments, draft.second, (v) => (draft.second = v)),
        ),
      );
    } else if (draft.type === "order") {
      parameters.append(
        field(
          "Sequenza",
          select(
            orderOptions,
            draft.order.join(","),
            (v) => (draft.order = v.split(",")),
          ),
        ),
      );
    } else {
      parameters.append(
        field(
          "Reparto",
          select(departments, draft.department, (v) => {
            draft.department = v;
            draft.professionalId = "";
            renderParameters();
          }),
        ),
      );
      if (draft.type === "professional") {
        const pool = state.professionals[draft.department];
        draft.professionalId = draft.professionalId || pool[0]?.id || "";
        parameters.append(
          field(
            "Professionista",
            select(
              pool.length
                ? pool.map((p) => [p.id, p.name])
                : [["", "Nessun professionista"]],
              draft.professionalId,
              (v) => (draft.professionalId = v),
            ),
          ),
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
          ["required", "Richiedi (obbligatorio)"],
        ],
        draft.strength,
        (v) => { draft.strength = v; editor.setAttribute("data-strength", v); },
      ),
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
          ["professional", "Professionista"],
        ],
        draft.type,
        (v) => {
          draft.type = v;
          renderParameters();
        },
      ),
    ),
    parameters,
    button("Aggiungi regola", () => {
      if (
        ["before", "after"].includes(draft.type) &&
        draft.first === draft.second
      ) {
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
    }),
  );
  editor.append(feedback);
  renderParameters();
  container.append(editor);
}
