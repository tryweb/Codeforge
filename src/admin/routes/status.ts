import { Hono } from "hono";
import { getAgentStatus } from "../agent";
import { collectStatus } from "../lib/status";

const status_route = new Hono();

status_route.get("/api/status", async (c) => {
  return c.json({ ...(await collectStatus()), agent_status: getAgentStatus() });
});

status_route.get("/healthz", (c) => {
  return c.json({ status: "ok" });
});

export default status_route;
