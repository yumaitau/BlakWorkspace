"use strict";
const { test, expect } = require("@playwright/test");
const { authentikLogin } = require("../helpers/auth");
const FORMS = "https://forms.homelab.local";
test("Forms dashboard requires login", async ({ page }) => {
  await page.goto(FORMS);
  await expect(
    page.getByRole("button", { name: "Blak ID", exact: true }),
  ).toBeVisible();
});
test("Forms SSO, create, publish, anonymous response, review and delete", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(20000);
  await page.goto(FORMS);
  await page.getByRole("button", { name: "Blak ID", exact: true }).click();
  await authentikLogin(page);
  await page.waitForURL(
    (u) =>
      u.hostname === "forms.homelab.local" &&
      u.pathname.startsWith("/workspace/"),
  );
  await expect(
    page.getByText("Blak Workspace", { exact: true }).first(),
  ).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--hf-brand").trim())).toBe("214,91,46");
  await page.locator('a[href*="/project/"]').first().click();
  await page.getByRole("button", { name: "Create Form", exact: true }).click();
  await page.getByText("Start from scratch", { exact: true }).click();
  await page.waitForURL(/\/form\/[^/]+\/create/);
  const formId = page.url().match(/\/form\/([^/]+)/)[1];
  const marker = "E2E-" + Date.now();
  let respondent;
  try {
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/graphql") &&
        r.request().postData()?.includes("updateFormSchemas"),
    );
    await page
      .locator("[contenteditable=true]")
      .first()
      .fill("What should we improve?");
    await saved;
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(/\/share/);
    respondent = await browser.newContext({ ignoreHTTPSErrors: true });
    const responsePage = await respondent.newPage();
    await responsePage.goto(FORMS + "/form/" + formId);
    await expect(
      responsePage.getByText("What should we improve?", { exact: true }),
    ).toBeVisible();
    await responsePage.getByPlaceholder("Your answer goes here").fill(marker);
    await responsePage.getByText("Submit", { exact: true }).click();
    await expect(
      responsePage.getByText("Thank you!", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Submissions", exact: true }).click();
    await expect(page.locator("body")).toContainText(marker);
    await page.screenshot({
      path: test.info().outputPath("forms-submission.png"),
      fullPage: true,
    });
  } finally {
    if (respondent) await respondent.close();
    const result = await page.request.post(FORMS + "/graphql", {
      timeout: 10000,
      data: {
        query: "mutation($input:FormDetailInput!){deleteForm(input:$input)}",
        variables: { input: { formId } },
      },
    });
    expect((await result.json()).errors).toBeUndefined();
  }
});
