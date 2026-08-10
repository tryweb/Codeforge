export interface Envelope {
  type: string;
  payload: unknown;
  id: string;
  timestamp: string;
}

export const MESSAGE_TYPES = Object.freeze({
  hello: "hello",
  hello_ack: "hello_ack",
  heartbeat: "heartbeat",
  ack: "ack",
  command: "command",
  error: "error",
});

export const ERROR_CODES = Object.freeze({
  malformed_message: "malformed_message",
  unknown_command: "unknown_command",
  malformed_command: "malformed_command",
  unsupported_version: "unsupported_version",
  auth_failed: "auth_failed",
});

export const PROTOCOL_VERSION = 1;

export type CommandName = "upgrade" | "reconfigure" | "restart";

let messageSequence = 0;

function createAcknowledgement(type: string, payload: unknown, acknowledgesId: string): Envelope {
  return {
    type,
    payload,
    id: acknowledgesId,
    timestamp: new Date().toISOString(),
  };
}

/** Create a protocol envelope with a fresh identifier and timestamp. */
export function createEnvelope(type: string, payload: unknown): Envelope {
  messageSequence += 1;
  return {
    type,
    payload,
    id: `agent-msg-${messageSequence}`,
    timestamp: new Date().toISOString(),
  };
}

/** Parse an untrusted JSON string into a protocol envelope. */
export function parseEnvelope(raw: string): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const type = Reflect.get(parsed, "type");
  const id = Reflect.get(parsed, "id");
  const timestamp = Reflect.get(parsed, "timestamp");
  if (typeof type !== "string" || typeof id !== "string" || typeof timestamp !== "string") return null;

  return {
    type,
    payload: Reflect.get(parsed, "payload"),
    id,
    timestamp,
  };
}

/** Build an error that acknowledges the referenced message. */
export function buildError(code: string, message: string, acknowledgesId: string): Envelope {
  return createAcknowledgement(MESSAGE_TYPES.error, { code, message }, acknowledgesId);
}

/** Build a command acknowledgement with its execution outcome. */
export function buildAck(
  acknowledgesId: string,
  outcome: {
    status: "success" | "failure";
    message: string;
    started_at: string;
    finished_at: string;
  },
): Envelope {
  return createAcknowledgement(MESSAGE_TYPES.ack, outcome, acknowledgesId);
}

/** Build a hello acknowledgement correlated to the hello message. */
export function buildHelloAck(acknowledgesId: string): Envelope {
  return createAcknowledgement(MESSAGE_TYPES.hello_ack, {}, acknowledgesId);
}

/** Build the initial agent hello message. */
export function buildHello(agentId: string): Envelope {
  return createEnvelope(MESSAGE_TYPES.hello, {
    agent_id: agentId,
    protocol_version: PROTOCOL_VERSION,
  });
}

/** Build an agent heartbeat message. */
export function buildHeartbeat(payload: unknown): Envelope {
  return createEnvelope(MESSAGE_TYPES.heartbeat, payload);
}

/** Extract a registration token from a center WebSocket URL. */
export function extractTokenFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("token");
  } catch (error: unknown) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/** Return whether an envelope acknowledges an agent hello. */
export function isHelloAck(env: Envelope): boolean {
  return env.type === MESSAGE_TYPES.hello_ack;
}

/** Parse a supported command name from an unknown payload. */
export function parseCommandName(payload: unknown): CommandName | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

  const commandName = Reflect.get(payload, "type");
  switch (commandName) {
    case "upgrade":
    case "reconfigure":
    case "restart":
      return commandName;
    default:
      return null;
  }
}
