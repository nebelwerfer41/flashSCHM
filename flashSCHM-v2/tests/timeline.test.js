import test from "node:test";
import assert from "node:assert/strict";
import { createTimeline } from "../js/timeline/timeline.js";
import { createState, createActor } from "../js/state.js";
import { generateSchedule } from "../js/scheduling/scheduler.js";
class DataSet {
  constructor() {
    this.data = new Map();
  }
  add(item) {
    this.data.set(item.id, item);
  }
  get(id) {
    return arguments.length ? this.data.get(id) : [...this.data.values()];
  }
  clear() {
    this.data.clear();
  }
  update(items) {
    for (const item of Array.isArray(items) ? items : [items])
      this.data.set(item.id, { ...this.data.get(item.id), ...item });
  }
  get length() {
    return this.data.size;
  }
}
class Timeline {
  static instances = [];
  constructor(container, items, groups, options) {
    Object.assign(this, { items, groups, options, events: [] });
    Timeline.instances.push(this);
  }
  on(event, callback) {
    this.events.push({ event, callback });
  }
  fit() {}
  destroy() {}
}
test("refresh keeps one select subscription; touching items require no horizontal gap", () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({ textContent: "", events: {}, setAttribute() {}, addEventListener(name, handler) { this.events[name] = handler; } }),
    getElementById: () => null,
  };
  try {
    const state = createState();
    state.actors = [
      createActor({ name: "Name - Same" }),
      createActor({ name: "Name - Same" }),
    ];
    state.actors.forEach((a) => (a.tasks[0].duration = 15));
    state.professionals.trucco = state.professionals.trucco.slice(0, 1);
    state.actors = generateSchedule(state).actors;
    let edits = 0;
    const adapter = createTimeline(
      {},
      { DataSet, Timeline },
      () => state,
      () => {
        edits++;
        adapter.render();
      },
    );
    for (let i = 0; i < 20; i++) adapter.render();
    const instance = Timeline.instances.at(-1);
    assert.equal(instance.events.length, 1);
    assert.equal(instance.options.margin.item.horizontal, 0);
    assert.equal(instance.items.length, 2);
    const item = instance.items.get()[0];
    instance.events[0].callback({ items: [item.id] });
    assert.equal(
      instance.items.get().filter((i) => i.className.includes("highlight"))
        .length,
      1,
    );
    const edited = {
      ...item,
      start: new Date(2023, 0, 1, 9, 0),
      end: new Date(2023, 0, 1, 9, 15),
    };
    let callbackCount = 0;
    instance.options.onMove(edited, (result) => {
      assert.ok(result);
      callbackCount++;
    });
    assert.equal(edits, 1);
    assert.equal(callbackCount, 1);
    assert.equal(state.actors[0].arrival, 540);
    instance.options.onMove(
      { ...edited, group: state.professionals.capelli[0].id },
      (result) => assert.equal(result, null),
    );
    assert.equal(edits, 1);
    const keyboardItem = instance.items.get()[0];
    keyboardItem.content.events.keydown({ key: "ArrowRight", shiftKey: false, preventDefault() {}, stopPropagation() {} });
    assert.equal(edits, 2);
    assert.equal(state.actors[0].arrival, 545);
    instance.items.get()[0].content.events.keydown({ key: "ArrowRight", shiftKey: true, preventDefault() {}, stopPropagation() {} });
    assert.equal(edits, 3);
    assert.equal(state.actors[0].schedule[0].end, 565);
  } finally {
    globalThis.document = previous;
  }
});
