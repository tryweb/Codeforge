import { Hono } from "hono";
import { runUpgrade, getState, getStatus, subscribe, getEventLog } from "../lib/upgrade";
import { UpgradePage } from "../views/upgrade";

const upgrade = new Hono();

upgrade.get("/api/upgrade/status", (c) => {
  return c.json(getStatus());
});

upgrade.post("/api/upgrade", async (c) => {
  const state = getState();
  if (state === "running") {
    return c.json({ error: "Upgrade already in progress", status: getStatus() }, 409);
  }
  // Fire and forget - run in background
  runUpgrade().catch(() => {});
  return c.json({ status: "started", log_url: "/api/upgrade/log" });
});

upgrade.get("/api/upgrade/log", (c) => {
  const history = c.req.query("history");
  if (history === "1") {
    return c.json(getEventLog());
  }

  // SSE stream
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  const stream = new ReadableStream({
    start(controller) {
      // Send existing events first
      for (const event of getEventLog()) {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      }

      const unsub = subscribe((event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
        if (event.step === "cleanup" && (event.status === "success" || event.status === "failure")) {
          setTimeout(() => controller.close(), 1000);
        }
      });

      // Proper disconnect cleanup via AbortSignal
      const abortController = new AbortController();
      c.req.raw.signal.addEventListener("abort", () => {
        unsub();
        abortController.abort();
      });
    },
  });

  return new Response(stream);
});

upgrade.get("/upgrade", (c) => {
  return c.html(UpgradePage());
});

export default upgrade;
