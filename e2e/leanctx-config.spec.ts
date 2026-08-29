import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const aiDevContainer = process.env.AI_DEV_CONTAINER ?? "ai-engkit-dev";

function applyButton(page: Page) {
  return page.getByRole("button", { name: "Apply Saved Config (lean-ctx config apply)" });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await page.goto("/leanctx");
}

function dockerExec(args: string[], options: { input?: string; interactive?: boolean } = {}): string {
  const flags = options.interactive ? ["-i"] : [];
  return execFileSync("docker", ["exec", ...flags, aiDevContainer, ...args], {
    encoding: "utf8",
    input: options.input,
  }).trim();
}

function aiDevStartedAt(): string {
  return execFileSync("docker", ["inspect", aiDevContainer, "--format", "{{.State.StartedAt}}"], {
    encoding: "utf8",
  }).trim();
}

test("unsaved edits gate Apply, Save re-enables it, and saved values survive reload", async ({ page }) => {
  await login(page);

  const compression = page.locator('tr[data-key="compression_level"] select');
  const original = await compression.inputValue();
  await expect(applyButton(page)).toBeEnabled();
  await expect(page.getByText("Raw TOML")).toHaveCount(0);

  await compression.selectOption(original === "lite" ? "max" : "lite");
  await compression.dispatchEvent("change");
  await expect(applyButton(page)).toBeDisabled();
  await expect(page.getByText("Save Changes before applying.")).toBeVisible();

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(applyButton(page)).toBeEnabled();
  await expect(page.locator("#config-status")).toHaveText(/Saved\. Apply when ready/);

  await page.reload();
  await expect(applyButton(page)).toBeEnabled();
  await expect(page.locator("#config-status")).toHaveText(/Saved configuration loaded\. Apply when ready/);
  await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue(
    original === "lite" ? "max" : "lite",
  );

  // Restore the original value so the matrix stays isolated.
  await compression.selectOption(original);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("#config-status")).toHaveText(/Saved\. Apply when ready/);
});

test("Reset to Defaults restores the baseline after a persisted override", async ({ page }) => {
  await login(page);

  const compression = page.locator('tr[data-key="compression_level"] select');
  await compression.selectOption("max");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("#config-status")).toHaveText(/Saved\. Apply when ready/);
  await page.reload();
  await expect(compression).toHaveValue("max");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset to Defaults" }).click();
  await expect(page.locator("#config-status")).toHaveText(/Baseline restored\./);
  await expect(compression).toHaveValue("lite");
  await expect(applyButton(page)).toBeEnabled();
  await page.reload();
  await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue("lite");
});

test("Apply runs lean-ctx config apply without recreating the ai-dev container", async ({ page }) => {
  await login(page);

  // Ensure a saved state so Apply is allowed.
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("#config-status")).toHaveText(/Saved\. Apply when ready/);

  const startedAtBefore = aiDevStartedAt();
  await applyButton(page).click();
  await expect(page.locator("#validate-output")).toContainText(
    "Saved configuration applied via lean-ctx config apply",
  );
  await expect(page.locator("#validate-output")).toContainText("the ai-dev container was not recreated");
  expect(aiDevStartedAt()).toBe(startedAtBefore);
});

test("Apply failure output is reported without lifecycle changes", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("#config-status")).toHaveText(/Saved\. Apply when ready/);

  await page.route("**/api/leanctx/apply", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, output: "apply boom", error: "apply boom" }),
    });
  });
  const startedAtBefore = aiDevStartedAt();
  await applyButton(page).click();
  await expect(page.locator("#validate-output")).toContainText("✗ Apply failed: apply boom");
  expect(aiDevStartedAt()).toBe(startedAtBefore);
  await page.unroute("**/api/leanctx/apply");
});

test("malformed global config blocks Save with 409 and Reset repairs it from the baseline", async ({ page }) => {
  const configPath = "/home/devuser/.config/lean-ctx/config.toml";
  const backupPath = "/tmp/leanctx-e2e-config.backup";
  await login(page);

  dockerExec(["cp", configPath, backupPath]);
  try {
    dockerExec(["tee", configPath], { input: "broken = [\n", interactive: true });
    await page.reload();

    await expect(page.getByText("Configuration requires repair.")).toBeVisible();
    await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue("lite");

    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect
      .poll(() => dialogMessage, { timeout: 10_000 })
      .toContain("is malformed");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reset to Defaults" }).click();
    await expect(page.locator("#config-status")).toHaveText(/Baseline restored\./);
    await expect(applyButton(page)).toBeEnabled();

    await page.reload();
    await expect(page.getByText("Configuration requires repair.")).toHaveCount(0);
    await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue("lite");
  } finally {
    dockerExec(["cp", backupPath, configPath]);
    dockerExec(["rm", "-f", backupPath]);
  }
});
