import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./style.css";
import tokens from "../../theme-tokens.json";
window.EXCALIDRAW_ASSET_PATH = "/draw/excalidraw/";
async function request(path = "", options = {}) {
  const response = await fetch("/api/draw" + path, {
    ...options,
    headers: { "content-type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
function App() {
  const [boards, setBoards] = useState([]),
    [board, setBoard] = useState(null),
    [name, setName] = useState(""),
    [status, setStatus] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [theme, setTheme] = useState(
    localStorage.getItem("blak-theme") || "dark",
  );
  useEffect(() => {
    const change = event => setTheme(event.detail);
    window.addEventListener('blak-theme-change', change);
    return () => window.removeEventListener('blak-theme-change', change);
  }, []);
  const scene = useRef(null),
    lastSaved = useRef(""),
    initialising = useRef(false);
  const reload = () =>
    request()
      .then(setBoards)
      .catch((e) => setStatus(e.message));
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function accept(b) {
    initialising.current = true;
    scene.current = b.scene;
    lastSaved.current = JSON.stringify(b.scene);
    setBoard(b);
    setDirty(false);
    setStatus("Saved");
  }
  async function run(action) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="app"
      data-theme={theme}
      style={Object.fromEntries(
        Object.entries({
          ...tokens.dark,
          ...(theme === "light" ? tokens.light : {}),
        }).map(([name, value]) => ["--" + name, value]),
      )}
    >
      <header>
        <a href="/" className="workspace-brand"><img src="/brand/logo.svg" alt="" width="28" height="28" />Blak Workspace</a>
        <strong>Blak Draw</strong>
        <span>Powered by Excalidraw</span>
        <button
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            setTheme(next);
            localStorage.setItem("blak-theme", next);
            document.documentElement.dataset.theme = next;
            document.cookie = `blak-theme=${next}; Domain=workspace.example.com; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
          }}
        >
          Switch theme
        </button>
      </header>
      <nav>
        <select
          aria-label="Saved drawings"
          disabled={busy}
          value={board?.id || ""}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            if (dirty && !confirm("Discard unsaved changes?")) return;
            run(async () => accept(await request("/" + id)));
          }}
        >
          <option value="">Choose drawing</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Drawing name"
          placeholder="New drawing name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={busy || !name.trim()}
          onClick={() => {
            if (dirty && !confirm("Discard unsaved changes?")) return;
            run(async () => {
              accept(
                await request("", {
                  method: "POST",
                  body: JSON.stringify({ name }),
                }),
              );
              setName("");
              await reload();
            });
          }}
        >
          New drawing
        </button>
        {board && (
          <>
            <button
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  const snapshot = scene.current;
                  const saved = await request("/" + board.id, {
                    method: "PUT",
                    body: JSON.stringify({
                      revision: board.revision,
                      scene: snapshot,
                    }),
                  });
                  lastSaved.current = JSON.stringify(snapshot);
                  setBoard({ ...saved, scene: board.scene });
                  setDirty(JSON.stringify(scene.current) !== lastSaved.current);
                  setStatus("Saved");
                  await reload();
                })
              }
            >
              Save drawing
            </button>
            <button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob(
                    [
                      JSON.stringify({
                        type: "excalidraw",
                        version: 2,
                        source: location.origin,
                        ...scene.current,
                      }),
                    ],
                    { type: "application/json" },
                  ),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = board.name + ".excalidraw";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export drawing
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm("Delete this drawing?"))
                  run(async () => {
                    await request("/" + board.id, {
                      method: "DELETE",
                      body: JSON.stringify({ revision: board.revision }),
                    });
                    setBoard(null);
                    setDirty(false);
                    await reload();
                    setStatus("Deleted");
                  });
              }}
            >
              Delete drawing
            </button>
          </>
        )}
        <output role="status">
          {error || (dirty ? "Unsaved changes" : status)}
        </output>
      </nav>
      <main>
        {board ? (
          <Excalidraw
            key={board.id}
            name={board.name}
            theme={theme}
            initialData={{
              ...board.scene,
              appState: { ...board.scene.appState, theme },
            }}
            onChange={(elements, appState, files) => {
              const next = {
                elements,
                appState: { viewBackgroundColor: appState.viewBackgroundColor },
                files,
              };
              scene.current = next;
              if (initialising.current) {
                lastSaved.current = JSON.stringify(next);
                initialising.current = false;
              }
              setDirty(JSON.stringify(next) !== lastSaved.current);
            }}
            UIOptions={{
              canvasActions: {
                loadScene: true,
                saveToActiveFile: true,
                export: { saveFileToDisk: true },
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.LoadScene />
              <MainMenu.DefaultItems.SaveToActiveFile />
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.ClearCanvas />
            </MainMenu>
          </Excalidraw>
        ) : (
          <section>
            <h1>Your private drawing space</h1>
            <p>
              Create a drawing or open a saved board. Save drawings to keep them
              across devices.
            </p>
            <p>Export files to share. Live co-editing is not enabled.</p>
          </section>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
