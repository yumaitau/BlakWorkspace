"use strict";
const { test, expect } = require("@playwright/test");
const CRM = "https://crm.homelab.local";
async function login(page) {
  const password = process.env.BLAK_CRM_PASSWORD;
  if (!password) throw new Error("BLAK_CRM_PASSWORD required");
  await page.goto(CRM);
  await page
    .getByPlaceholder("Email", { exact: true })
    .fill(process.env.BLAK_CRM_EMAIL || "admin@blak.local");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/objects\//);
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue("--t-accent-accent9")
          .trim(),
      ),
    )
    .toBe("#D65B2E");
}
async function saveName(page, name) {
  const saved = page.waitForResponse((response) => {
    const body = response.request().postData() || "";
    return body.includes("mutation") && body.includes(name);
  });
  await page.getByPlaceholder("Name", { exact: true }).fill(name);
  await page.getByPlaceholder("Name", { exact: true }).press("Tab");
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).errors).toBeUndefined();
}
test("CRM requires authentication", async ({ page }) => {
  await page.goto(CRM);
  await expect(page.getByPlaceholder("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("All Companies", { exact: true })).toHaveCount(0);
});
for (const [type, section] of [
  ["Company", "Companies"],
  ["Opportunity", "Opportunities"],
])
  test(`CRM ${type}: login, create, persist, update and delete`, async ({
    page,
  }) => {
    page.setDefaultTimeout(20000);
    await login(page);
    await page.getByRole("link", { name: section, exact: true }).click();
    const name = "E2E " + type + " " + Date.now(),
      updated = name + " Updated";
    await page
      .getByRole("button", { name: "Create new " + type, exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await saveName(page, name);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).click();
    await saveName(page, updated);
    await page.reload();
    await expect(
      page.getByText(updated, { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("crm-company.png"),
      fullPage: true,
    });
    await page
      .getByText(updated, { exact: true })
      .first()
      .click({ button: "right" });
    await page.getByText("Delete " + type, { exact: true }).click();
    await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
  });
test("CRM people persist and can be deleted", async ({ page }) => {
  page.setDefaultTimeout(20000);
  await login(page);
  await page.getByRole("link", { name: "People", exact: true }).click();
  const name = "E2EPerson" + Date.now();
  await page
    .getByRole("button", { name: "Create new Person", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const saved = page.waitForResponse((r) => {
    const body = r.request().postData() || "";
    return (
      body.includes("mutation") &&
      body.includes(name) &&
      body.includes("lastName") &&
      body.includes("Test")
    );
  });
  await page.getByPlaceholder(/irst name/).fill(name);
  await page.getByPlaceholder(/ast name/).fill("Test");
  await page.getByPlaceholder(/ast name/).press("Tab");
  expect((await (await saved).json()).errors).toBeUndefined();
  await expect(
    page.getByText(name + " Test", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("link", { name: name + " Test", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: name + " Test", exact: true })
    .click({ button: "right" });
  await page.getByText("Delete Person", { exact: true }).click();
  await expect(page.getByText(name + " Test", { exact: true })).toHaveCount(0);
});
