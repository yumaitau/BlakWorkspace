"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDrawStore } = require("../draw-store");
test("drawings persist, isolate owners and reject stale writes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blak-draw-"));
  try {
    const store = createDrawStore(dir),
      board = store.create("alice", "First board");
    assert.equal(store.list("bob").length, 0);
    assert.throws(() => store.read("bob", board.id), { status: 404 });
    assert.throws(() => store.read("alice", "../other"), { status: 404 });
    const saved = store.save("alice", board.id, {
      revision: 1,
      scene: { elements: [{ id: "shape" }], appState: {}, files: {} },
    });
    assert.equal(
      createDrawStore(dir).read("alice", board.id).scene.elements[0].id,
      "shape",
    );
    assert.throws(
      () => store.save("alice", board.id, { revision: 1, scene: board.scene }),
      { status: 409 },
    );
    assert.throws(() => store.remove("alice", board.id, 1), { status: 409 });
    store.remove("alice", board.id, saved.revision);
    assert.deepEqual(store.list("alice"), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid name and scene rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blak-draw-"));
  try {
    const store = createDrawStore(dir);
    assert.throws(() => store.create("alice", " "), { status: 400 });
    const board = store.create("alice", "Valid");
    assert.throws(
      () => store.save("alice", board.id, { revision: 1, scene: null }),
      { status: 400 },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
