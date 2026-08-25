import { describe, expect, test } from "bun:test";
import { createLeanCtxRoutes } from "./leanctx";
import type { DoneClaim } from "../lib/leanctx-drift";

const checkedAt = "2026-08-25T00:00:00.000Z";

function routeFor(claim: DoneClaim): ReturnType<typeof createLeanCtxRoutes> {
  return createLeanCtxRoutes({ detectDrift: async () => claim });
}

describe("GET /api/leanctx/drift", () => {
  test("returns a healthy claim with its checked timestamp", async () => {
    const claim: DoneClaim = { done: true, status: "healthy", details: [], checkedAt };

    const response = await routeFor(claim).request("http://localhost/api/leanctx/drift");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(claim);
  });

  test("returns an indeterminate claim without changing its status", async () => {
    const claim: DoneClaim = {
      done: true,
      status: "indeterminate",
      details: ["global config is unavailable"],
      checkedAt,
    };

    const response = await routeFor(claim).request("http://localhost/api/leanctx/drift");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(claim);
  });

  test("returns a generic error when the detector fails at the boundary", async () => {
    const app = createLeanCtxRoutes({ detectDrift: async () => {
      throw new Error("private detector details");
    } });

    const response = await app.request("http://localhost/api/leanctx/drift");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "LeanCTX drift detection unavailable" });
  });
});
