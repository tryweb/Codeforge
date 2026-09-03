import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const NPM_PACKAGE = "typescript-language-server";
const SERVER_KEY = "typescript";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function stubLspApi(page: Page, rows: Array<Record<string, unknown>>) {
  await page.route("**/api/lsp", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ servers: rows }) });
      return;
    }
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/lsp/versions?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ package: NPM_PACKAGE, latest: "6.1.0", versions: ["6.1.0", "6.0.0", "5.4.0", "5.3.0", "5.2.0"] }),
    });
  });
}

function baseRows(overrides: Partial<Record<string, unknown>> = {}): Array<Record<string, unknown>> {
  return [
    {
      serverKey: SERVER_KEY,
      npmPackage: NPM_PACKAGE,
      command: "typescript-language-server --stdio",
      extensions: [".ts", ".tsx"],
      defaultEnabled: false,
      enabled: false,
      pinnedVersion: null,
      installedVersion: null,
      inLspBlock: false,
      drift: null,
      ...overrides,
    },
  ];
}

test("LSP page lists the catalog servers and version dropdown", async ({ page }) => {
  await signIn(page);
  await stubLspApi(page, baseRows());
  await page.goto("/lsp");

  await expect(page.locator("main h2")).toHaveText("LSP Server Management");
  const row = page.locator(`tr[data-key="${SERVER_KEY}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(NPM_PACKAGE);
  await expect(page.getByRole("button", { name: "Apply Changes" })).toBeEnabled();

  const versionSelect = row.locator(`.lsp-version[data-row="${SERVER_KEY}"]`);
  await expect(versionSelect).toBeEnabled();
  // Newest version is exposed as an option after the versions load.
  await expect(page.locator(`select.lsp-version[data-row="${SERVER_KEY}"] option[value="6.1.0"]`)).toHaveCount(1);
});

test("LSP page persists an enabled + pinned override and reports apply", async ({ page }) => {
  await signIn(page);
  await stubLspApi(page, baseRows());
  await page.goto("/lsp");

  const row = page.locator(`tr[data-key="${SERVER_KEY}"]`);
  await row.locator(`.lsp-toggle[data-row="${SERVER_KEY}"]`).check();

  const versionSelect = row.locator(`.lsp-version[data-row="${SERVER_KEY}"]`);
  await expect(versionSelect.locator(`option[value="6.0.0"]`)).toHaveCount(1);
  await versionSelect.selectOption("6.0.0");

  let applyCalled = false;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/lsp") && req.method() === "PUT") applyCalled = true;
    if (req.url().endsWith("/api/lsp/apply") && req.method() === "POST") applyCalled = true;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Apply Changes" }).click();
  await expect.poll(() => applyCalled).toBe(true);
});
