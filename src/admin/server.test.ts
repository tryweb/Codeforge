import { expect, test } from "bun:test";

process.env.ADMIN_PASSWORD = "test-admin-password";

const { app } = await import("./server");

test("OpenChamber settings API requires an admin session", async () => {
  const response = await app.request("http://localhost/api/openchamber/settings");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("OpenChamber settings writes require an admin session", async () => {
  const response = await app.request("http://localhost/api/openchamber/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showOpenCodeUpdateNotifications: true }),
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("OpenChamber settings page redirects unauthenticated users", async () => {
  const response = await app.request("http://localhost/openchamber", { redirect: "manual" });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/login");
});
