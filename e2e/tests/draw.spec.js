"use strict";
const { test, expect, session } = require("../helpers/fixtures");
test("Draw requires authentication", async ({ request }) => {
  expect((await request.get("/api/draw")).status()).toBe(401);
  expect((await request.get("/draw", { maxRedirects: 0 })).status()).toBe(302);
});
test("draw, save, reopen, export and delete a private board", async ({
  signedIn: page,
}) => {
  await page.goto("/draw");
  await page.getByLabel("Drawing name").fill("E2E diagram");
  await page.getByRole("button", { name: "New drawing", exact: true }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page
    .getByTitle(/Rectangle/)
    .first()
    .click();
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 420, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 320, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save drawing", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const list = await (await page.request.get("/api/draw")).json();
  const board = list.find((b) => b.name === "E2E diagram");
  try {
    const data = await (await page.request.get("/api/draw/" + board.id)).json();
    expect(
      data.scene.elements.some((e) => e.type === "rectangle"),
    ).toBeTruthy();
    await page.reload();
    await page.getByLabel("Saved drawings").selectOption(board.id);
    await expect(page.locator(".excalidraw")).toBeVisible();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export drawing", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.excalidraw$/);
  } finally {
    const latest = await (
      await page.request.get("/api/draw/" + board.id)
    ).json();
    expect(
      (
        await page.request.delete("/api/draw/" + board.id, {
          data: { revision: latest.revision },
        })
      ).ok(),
    ).toBeTruthy();
  }
});
test("Draw denies other owners and stale updates", async ({
  signedIn: page,
  browser,
  baseURL,
}) => {
  const board = await (
    await page.request.post("/api/draw", { data: { name: "Private board" } })
  ).json();
  const other = await browser.newContext({ ...publicNetworkOptions, ignoreHTTPSErrors: true, baseURL });
  await other.addCookies([
    { name: "blak_session", value: session("other-draw-owner"), url: baseURL },
  ]);
  try {
    expect((await other.request.get("/api/draw/" + board.id)).status()).toBe(
      404,
    );
    expect(
      (
        await page.request.put("/api/draw/" + board.id, {
          data: { revision: 0, scene: board.scene },
        })
      ).status(),
    ).toBe(409);
  } finally {
    await page.request.delete("/api/draw/" + board.id, {
      data: { revision: board.revision },
    });
    await other.close();
  }
});
