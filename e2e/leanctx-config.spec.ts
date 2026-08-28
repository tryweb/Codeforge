import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const aiDevContainer = process.env.AI_DEV_CONTAINER ?? "ai-engkit-dev";

test("Save Changes gates daemon restart Apply", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await page.goto("/leanctx");

  const apply = page.getByRole("button", { name: "Apply Saved Config (restarts daemon)" });
  await expect(apply).toBeDisabled();
  await expect(page.getByText("Raw TOML")).toHaveCount(0);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(apply).toBeEnabled();
  await expect(page.getByText("applying restarts the LeanCTX daemon in ai-dev.")).toBeVisible();

  await page.reload();
  await page.locator('tr[data-key="compression_level"] select').selectOption("lite");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Saved. Apply when ready")).toBeVisible();

});

test("saved values survive reload and Reset to Defaults restores the baseline", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await page.goto("/leanctx");

  const initialCompression = page.locator('tr[data-key="compression_level"] select');
  await initialCompression.selectOption("lite");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Saved. Apply when ready")).toBeVisible();
  await page.reload();

  const compression = page.locator('tr[data-key="compression_level"] select');
  await compression.selectOption("max");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Saved. Apply when ready")).toBeVisible();
  await page.reload();
  await expect(compression).toHaveValue("max");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset to Defaults" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Saved. Apply when ready")).toBeVisible();
  await page.reload();
  await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue("lite");
});

test("malformed runtime config is backed up and recovered from the baseline", async ({ page }) => {
  const configPath = "/home/devuser/.config/lean-ctx/config.toml";
  const backupPath = "/tmp/leanctx-e2e-config.backup";
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  execFileSync("docker", ["exec", aiDevContainer, "cp", configPath, backupPath]);

  try {
    execFileSync("docker", ["exec", "-i", aiDevContainer, "tee", configPath], { input: "broken = [\n" });
    execFileSync("docker", ["restart", aiDevContainer]);
    await page.waitForTimeout(3000);
    await page.goto("/leanctx");
    await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue("lite");
    execFileSync("docker", ["exec", aiDevContainer, "sh", "-c", `test -n "$(find /home/devuser/.config/lean-ctx -name 'config.toml.malformed.*' -print -quit)"`]);
  } finally {
    execFileSync("docker", ["exec", aiDevContainer, "cp", backupPath, configPath]);
    execFileSync("docker", ["restart", aiDevContainer]);
  }
});

test("project override warning persists and disappears after the override is removed", async ({ page }) => {
  const projectPath = "/home/devuser/workspace/ai-engkit/.lean-ctx.toml";
  const projectDir = "/home/devuser/workspace/ai-engkit";
  const backupPath = "/tmp/leanctx-e2e-project-config.backup";
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);

  let hadProjectConfig = false;
  let hadProjectDir = false;
  try {
    execFileSync("docker", ["exec", aiDevContainer, "test", "-d", projectDir]);
    hadProjectDir = true;
  } catch {
    hadProjectDir = false;
  }
  try {
    execFileSync("docker", ["exec", aiDevContainer, "cp", projectPath, backupPath]);
    hadProjectConfig = true;
  } catch {
    hadProjectConfig = false;
  }

  try {
    execFileSync("docker", ["exec", aiDevContainer, "mkdir", "-p", projectDir]);
    execFileSync("docker", [
      "exec",
      aiDevContainer,
      "sh",
      "-c",
      `printf '%s\\n' 'compression_level = "lite"' > ${projectPath}`,
    ]);
    await page.goto("/leanctx");

    const warning = page.locator('[data-drift-status="project_override"]').first();
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute("role", "alert");
    await warning.focus();
    await expect(warning).toBeFocused();
    await expect(warning).toContainText("Project override detected.");
    await expect(warning).toContainText("Detection does not apply or restart configuration.");
  } finally {
    if (hadProjectConfig) {
      execFileSync("docker", ["exec", aiDevContainer, "cp", backupPath, projectPath]);
    } else {
      execFileSync("docker", ["exec", aiDevContainer, "rm", "-f", projectPath]);
      if (!hadProjectDir) execFileSync("docker", ["exec", aiDevContainer, "rmdir", projectDir]);
    }
    execFileSync("docker", ["exec", aiDevContainer, "rm", "-f", backupPath]);
  }

  await page.reload();
  await expect(page.locator(".leanctx-drift-warning")).toHaveCount(0);
});

test("daemon-unavailable warning is accessible and recovers without applying or restarting", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Password" }).fill(process.env.ADMIN_PASSWORD ?? "testadmin123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);

  await page.route("**/api/leanctx/drift", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        done: true,
        status: "daemon_unavailable",
        details: ["sentinel exited with code 1"],
        checkedAt: "2026-08-25T00:00:00.000Z",
      }),
    });
  });
  await page.goto("/leanctx");

  const warning = page.locator("#leanctx-drift-client-warning");
  await expect(warning).toBeVisible();
  await warning.focus();
  await expect(warning).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("LeanCTX daemon unavailable.");
  await expect(page.getByRole("alert")).toContainText("Detection does not apply or restart configuration.");

  await page.unroute("**/api/leanctx/drift");
  await page.reload();
  await expect(page.locator(".leanctx-drift-warning")).toHaveCount(0);
});
