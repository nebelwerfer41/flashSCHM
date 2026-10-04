import test from "node:test";
import assert from "node:assert/strict";
import { createState, createActor } from "../js/state.js";
import { generateSchedule } from "../js/scheduling/scheduler.js";
import { renderActors } from "../js/ui/render.js";
class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.events = {};
    this.attributes = {};
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  addEventListener(type, fn) {
    this.events[type] = fn;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  setCustomValidity() {}
  reportValidity() {
    return true;
  }
}
const all = (node) => [
  node,
  ...node.children.filter((n) => typeof n === "object").flatMap(all),
];
test("actor fields bind through input events; edits after generation remain connected to state", () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag) };
  try {
    const state = createState();
    state.actors = [createActor()];
    const container = new Node("div");
    renderActors(
      container,
      state,
      () => {},
      () => {},
    );
    const name = all(container).find(
      (n) => n.attributes["aria-label"] === "Attore",
    );
    name.value = "First";
    name.events.input();
    assert.equal(state.actors[0].name, "First");
    const result = generateSchedule(state);
    // Entry point copies schedule fields, preserving the live actor identity used by controls.
    for (const actor of state.actors) {
      const scheduled = result.actors.find((a) => a.id === actor.id);
      actor.schedule = scheduled.schedule;
      actor.arrival = scheduled.arrival;
    }
    name.value = "Renamed - after scheduling";
    name.events.input();
    assert.equal(
      generateSchedule(state).actors[0].name,
      "Renamed - after scheduling",
    );
  } finally {
    globalThis.document = previous;
  }
});
