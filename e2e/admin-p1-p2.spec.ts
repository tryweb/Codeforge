import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test("P1 agent settings expose editable center fields and status", async ({ page }) => {
  await signIn(page);
  await page.goto("/agent");
  await expect(page.locator("main h2")).toBeVisible();
  await expect(page.locator("#ag-CENTER_URL")).toBeVisible();
  await expect(page.locator("#ag-CENTER_TOKEN")).toBeVisible();
  await expect(page.locator("#ag-AGENT_ID")).toBeVisible();
  await expect(page.locator("#agent-state-badge")).toBeVisible();
});

test("P1 environment editor opens an edit dialog without changing state", async ({ page }) => {
  await signIn(page);
  await page.goto("/env");

  await expect(page.locator("main h2")).toBeVisible();
  const editButton = page.getByRole("button", { name: "Edit" }).first();
  await expect(editButton).toBeVisible();
  await editButton.click();
  await expect(page.locator("#edit-modal")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#edit-modal")).toBeHidden();
});

test("P1 upgrade page exposes status and does not start a destructive upgrade", async ({ page }) => {
  await signIn(page);
  await page.goto("/upgrade");

  await expect(page.locator("main h2")).toBeVisible();
  const status = await page.request.get("/api/upgrade/status");
  expect(status.ok()).toBe(true);
  expect((await status.json()).state).toBeDefined();
  const history = await page.request.get("/api/upgrade/log?history=1");
  expect(history.ok()).toBe(true);
  expect(Array.isArray(await history.json())).toBe(true);
});

test("P2 project page exposes capability and remote filters", async ({ page }) => {
  await signIn(page);
  await page.goto("/projects");

  await expect(page.locator("#filter-cap")).toBeVisible();
  await expect(page.locator("#filter-remote")).toBeVisible();
  await expect(page.locator("#filter-status")).toBeVisible();
});

test("P2 project API persists a remote and enables a capability", async ({ page }) => {
  await signIn(page);
  const projectName = `e2e-p2-${Date.now()}`;
  const created = await page.request.post("/api/projects", {
    data: { name: projectName, git_init: false },
  });
  expect(created.ok()).toBe(true);

  try {
    const savedRemote = await page.request.put(`/api/projects/${encodeURIComponent(projectName)}/git-remote`, {
      data: { url: "" },
    });
    expect(savedRemote.ok()).toBe(true);

    const remoteResult = await page.request.get(`/api/projects/${encodeURIComponent(projectName)}/git-remote`);
    expect((await remoteResult.json()).remote).toBeNull();

    const feature = await page.request.post(`/api/projects/${encodeURIComponent(projectName)}/features/knowledge`);
    expect(feature.ok()).toBe(true);
    const features = await page.request.get(`/api/projects/${encodeURIComponent(projectName)}/features`);
    expect((await features.json()).knowledge).toBe(true);
  } finally {
    await page.request.post(`/api/projects/${encodeURIComponent(projectName)}/delete`, {
      data: { confirmation_name: projectName },
    });
  }
});

test("P2 settings pages expose OpenChamber, Git, and SSH controls", async ({ page }) => {
  await signIn(page);

  await page.goto("/openchamber");
  await expect(page.locator("main h2")).toBeVisible();
  const toggle = page.locator("input[type=checkbox]").first();
  await expect(toggle).toBeVisible();
  const originalSettings = await page.request.get("/api/openchamber/settings");
  const originalValue = (await originalSettings.json()).showOpenCodeUpdateNotifications;
  const updatedSettings = await page.request.put("/api/openchamber/settings", {
    data: { showOpenCodeUpdateNotifications: !originalValue },
  });
  expect(updatedSettings.ok()).toBe(true);
  await page.request.put("/api/openchamber/settings", {
    data: { showOpenCodeUpdateNotifications: originalValue },
  });

  await page.goto("/git-config");
  await expect(page.locator("#user-name")).toBeVisible();
  await expect(page.locator("#user-email")).toBeVisible();

  await page.goto("/ssh-keys");
  await expect(page.getByRole("button", { name: /Generate/i })).toBeVisible();
  await page.getByRole("button", { name: /Generate/i }).click();
  await expect(page.locator("#generate-modal")).toBeVisible();
});

test("P2 logout clears the browser session and returns to login", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
});
