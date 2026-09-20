"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
function createDrawStore(directory) {
  const folder = (owner) =>
    path.join(
      directory,
      crypto.createHash("sha256").update(owner).digest("hex"),
    );
  const file = (owner, id) => {
    if (!/^[a-f0-9]{32}$/.test(id)) fail(404, "Drawing not found");
    return path.join(folder(owner), id + ".json");
  };
  function read(owner, id) {
    try {
      return JSON.parse(fs.readFileSync(file(owner, id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") fail(404, "Drawing not found");
      throw e;
    }
  }
  function write(owner, board) {
    fs.mkdirSync(folder(owner), { recursive: true, mode: 0o700 });
    const target = file(owner, board.id);
    fs.writeFileSync(target + ".tmp", JSON.stringify(board), { mode: 0o600 });
    fs.renameSync(target + ".tmp", target);
    return board;
  }
  function list(owner) {
    if (!fs.existsSync(folder(owner))) return [];
    return fs
      .readdirSync(folder(owner))
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const b = read(owner, f.slice(0, -5));
        return {
          id: b.id,
          name: b.name,
          revision: b.revision,
          updatedAt: b.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function create(owner, name) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100)
      fail(400, "Name must contain 1–100 characters");
    return write(owner, {
      id: crypto.randomBytes(16).toString("hex"),
      name: name.trim(),
      revision: 1,
      updatedAt: new Date().toISOString(),
      scene: {
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
    });
  }
  function check(board, revision) {
    if (board.revision !== revision)
      fail(409, "Drawing changed in another window. Reopen it before saving.");
  }
  function save(owner, id, { revision, scene }) {
    const board = read(owner, id);
    check(board, revision);
    if (
      !scene ||
      !Array.isArray(scene.elements) ||
      !scene.appState ||
      typeof scene.appState !== "object" ||
      !scene.files ||
      typeof scene.files !== "object"
    )
      fail(400, "Invalid drawing");
    return write(owner, {
      ...board,
      scene,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
    });
  }
  function remove(owner, id, revision) {
    const board = read(owner, id);
    check(board, revision);
    fs.unlinkSync(file(owner, id));
    return { ok: true };
  }
  return { list, read, create, save, remove };
}
module.exports = { createDrawStore };
