import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: process.env.ADMIN_BASE_URL ?? "http://172.20.0.1:8081",
    ...devices["Desktop Chrome"],
  },
});
