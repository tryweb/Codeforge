import { createHmac, timingSafeEqual } from "node:crypto";
import { readEnvFile } from "./env";

const SESSION_COOKIE = "session";
const HMAC_ALGO = "sha256";
const SALT = "ai-admin-session-v1";

export interface SessionPayload {
  created: number;
}

function getPassword(): string | null {
  const pw = readEnvFile().ADMIN_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

export function isConfigured(): boolean {
  return getPassword() !== null;
}

function sign(payload: SessionPayload, secret: string): string {
  const data = JSON.stringify(payload) + "." + SALT;
  const hmac = createHmac(HMAC_ALGO, secret).update(data).digest("hex");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${hmac}`;
}

function verify(token: string, secret: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const data = Buffer.from(encoded, "base64url").toString("utf-8");
  const checkData = data + "." + SALT;
  const expected = createHmac(HMAC_ALGO, secret).update(checkData).digest("hex");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return JSON.parse(data) as SessionPayload;
}

export function createSessionCookie(): string {
  const password = getPassword();
  if (!password) return "";
  const payload: SessionPayload = { created: Date.now() };
  const token = sign(payload, password);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function validateSession(token: string): boolean {
  const password = getPassword();
  if (!password || !token) return false;
  return verify(token, password) !== null;
}

export function validatePassword(input: string): boolean {
  const password = getPassword();
  if (!password || !input) return false;
  if (input.length !== password.length) return false;
  return timingSafeEqual(Buffer.from(input), Buffer.from(password));
}

let loginAttempts = 0;
let lastFailedAt = 0;

export function checkBruteForce(): number | null {
  if (loginAttempts >= 5) {
    const elapsed = Date.now() - lastFailedAt;
    if (elapsed < 3000) return 3000 - elapsed;
  }
  return null;
}

export function recordFailedAttempt(): void {
  loginAttempts++;
  lastFailedAt = Date.now();
}

export function resetAttempts(): void {
  loginAttempts = 0;
}
