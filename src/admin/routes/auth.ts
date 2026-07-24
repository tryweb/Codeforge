import { Hono } from "hono";
import {
  createSessionCookie,
  clearSessionCookie,
  validatePassword,
  checkBruteForce,
  recordFailedAttempt,
  resetAttempts,
  isConfigured,
} from "../lib/auth";
import { upsertEnvVar } from "../lib/env";
import { LoginPage } from "../views/login";
import { SetupPage } from "../views/setup";

const auth = new Hono();

// Login page
auth.get("/login", (c) => {
  if (!isConfigured()) return c.redirect("/setup");
  const error = c.req.query("error");
  return c.html(LoginPage(error ? undefined : c.req.query("redirect") || "/"));
});

// Login API
auth.post("/api/login", async (c) => {
  if (!isConfigured()) return c.json({ error: "Not configured" }, 400);

  // Brute force check
  const delay = checkBruteForce();
  if (delay !== null && delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
  }

  let password: string;
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    password = body.password || "";
  } else {
    const formData = await c.req.parseBody();
    password = (formData.password as string) || "";
  }

  if (!validatePassword(password)) {
    recordFailedAttempt();
    const accept = c.req.header("accept") || "";
    if (accept.includes("text/html")) {
      return c.redirect("/login?error=1");
    }
    return c.json({ error: "Invalid password" }, 401);
  }

  resetAttempts();
  const cookie = createSessionCookie();
  c.header("Set-Cookie", cookie);

  const accept = c.req.header("accept") || "";
  if (accept.includes("text/html")) {
    const formData = await c.req.parseBody();
    const redirect = (formData.redirect as string) || "/";
    return c.redirect(redirect);
  }
  return c.json({ ok: true });
});

// Logout API
auth.post("/api/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  const accept = c.req.header("accept") || "";
  if (accept.includes("text/html")) return c.redirect("/login");
  return c.json({ ok: true });
});

// Setup page
auth.get("/setup", (c) => {
  if (isConfigured()) return c.redirect("/login");
  return c.html(SetupPage());
});

// Setup API
auth.post("/api/setup", async (c) => {
  if (isConfigured()) return c.json({ error: "Already configured" }, 400);
  const body = await c.req.json();
  const { password, confirm } = body;

  if (!password || password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }
  if (password !== confirm) {
    return c.json({ error: "Passwords do not match" }, 400);
  }

  upsertEnvVar("ADMIN_PASSWORD", password);
  const cookie = createSessionCookie();
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

export default auth;
