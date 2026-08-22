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
  execFileSync("docker", ["exec", "ai-engkit-dev", "cp", configPath, backupPath]);

  try {
    execFileSync("docker", ["exec", "-i", aiDevContainer, "tee", configPath], { input: "broken = [\n" });
    execFileSync("docker", ["compose", "-f", "../docker-compose.dev.yml", "restart", "ai-dev"]);
    await page.waitForTimeout(3000);
    await page.goto("/leanctx");
    await expect(page.locator('tr[data-key="compression_level"] select')).toHaveValue("lite");
    execFileSync("docker", ["exec", "ai-engkit-dev", "sh", "-c", `test -n "$(find /home/devuser/.config/lean-ctx -name 'config.toml.malformed.*' -print -quit)"`]);
  } finally {
    execFileSync("docker", ["exec", "ai-engkit-dev", "cp", backupPath, configPath]);
    execFileSync("docker", ["compose", "-f", "../docker-compose.dev.yml", "restart", "ai-dev"]);
  }
});
