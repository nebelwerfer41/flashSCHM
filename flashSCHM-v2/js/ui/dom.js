export function el(tag, props = {}, ...children) {
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
export function select(options, value, onchange) {
  const node = el(
    "select",
    {},
    ...options.map(([id, label]) => el("option", { value: id, text: label })),
  );
  node.value = value;
  node.addEventListener("change", () => onchange(node.value));
  return node;
}
let fieldId = 0;
export const field = (label, node) => {
  node.id ||= `field-${++fieldId}`;
  return el("label", { htmlFor: node.id }, el("span", { text: label }), node);
};
export const button = (label, onclick) =>
  el("button", { type: "button", text: label, onclick,
    className: label.startsWith("Rimuovi") ? "danger" : "" });
