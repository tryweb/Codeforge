import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("./providers-page.js", import.meta.url), "utf8");
const viewCode = readFileSync(new URL("../views/providers.tsx", import.meta.url), "utf8");

function loadValidators(entries: Record<string, unknown>): {
  validateUrl: (value: string) => boolean;
  validateProviderName: (value: string) => { valid: boolean; error: string | null };
  validateNpm: (value: string) => { valid: boolean; error: string | null };
  validateBaseURL: (value: string) => { valid: boolean; error: string | null };
} {
  const windowStub = { providersBoot: { entries, meta: [] } };
  const factory = new Function(
    "window",
    "document",
    `${code}\n;return { validateUrl, validateProviderName, validateNpm, validateBaseURL };`,
  );
  return factory(windowStub, {}) as ReturnType<typeof loadValidators>;
}

function loadShowFieldError(): {
  showFieldError: (prefix: string, field: string, error: string | null) => void;
  ids: string[];
} {
  const windowStub = { providersBoot: { entries: {}, meta: [] } };
  const ids: string[] = [];
  const documentStub = {
    getElementById: (id: string) => {
      ids.push(id);
      return { textContent: "", style: { display: "" } };
    },
  };
  const factory = new Function(
    "window",
    "document",
    `${code}\n;return { showFieldError };`,
  );
  const out = factory(windowStub, documentStub) as { showFieldError: (prefix: string, field: string, error: string | null) => void };
  return { showFieldError: out.showFieldError, ids };
}

describe("providers-page validation", () => {
  describe("validateUrl", () => {
    it("accepts empty values (optional field)", () => {
      const { validateUrl } = loadValidators({});
      expect(validateUrl("")).toBe(true);
    });

    it("accepts https URLs", () => {
      const { validateUrl } = loadValidators({});
      expect(validateUrl("https://api.openai.com/v1")).toBe(true);
    });

    it("accepts http URLs including localhost", () => {
      const { validateUrl } = loadValidators({});
      expect(validateUrl("http://localhost:11434/v1")).toBe(true);
    });

    it("rejects non-URL strings", () => {
      const { validateUrl } = loadValidators({});
      expect(validateUrl("not-a-url")).toBe(false);
    });

    it("rejects non-http(s) protocols", () => {
      const { validateUrl } = loadValidators({});
      expect(validateUrl("ftp://example.com")).toBe(false);
    });
  });

  describe("validateProviderName", () => {
    it("requires a non-empty name", () => {
      const { validateProviderName } = loadValidators({});
      expect(validateProviderName("")).toEqual({
        valid: false,
        error: "Provider name is required",
      });
      expect(validateProviderName("   ").valid).toBe(false);
    });

    it("accepts lowercase alphanumeric names with hyphens", () => {
      const { validateProviderName } = loadValidators({});
      expect(validateProviderName("my-provider").valid).toBe(true);
      expect(validateProviderName("ollama2").valid).toBe(true);
    });

    it("rejects uppercase, spaces, and underscores", () => {
      const { validateProviderName } = loadValidators({});
      expect(validateProviderName("My-Provider").valid).toBe(false);
      expect(validateProviderName("my provider").valid).toBe(false);
      expect(validateProviderName("my_provider").valid).toBe(false);
    });

    it("rejects names already defined in OPENCODE_PROVIDER", () => {
      const { validateProviderName } = loadValidators({ "opencode-go": { npm: "x" } });
      const result = validateProviderName("opencode-go");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("already exists");
    });
  });

  describe("validateNpm", () => {
    it("requires a non-empty package", () => {
      const { validateNpm } = loadValidators({});
      expect(validateNpm("").valid).toBe(false);
      expect(validateNpm("  ").valid).toBe(false);
    });

    it("accepts scoped and plain package names", () => {
      const { validateNpm } = loadValidators({});
      expect(validateNpm("@ai-sdk/openai-compatible").valid).toBe(true);
      expect(validateNpm("openai").valid).toBe(true);
      expect(validateNpm("@scope/package-name").valid).toBe(true);
    });

    it("rejects malformed package names", () => {
      const { validateNpm } = loadValidators({});
      expect(validateNpm("foo bar").valid).toBe(false);
      expect(validateNpm("UPPER").valid).toBe(false);
      expect(validateNpm("@scope").valid).toBe(false);
    });
  });

  describe("validateBaseURL", () => {
    it("accepts empty values (optional field)", () => {
      const { validateBaseURL } = loadValidators({});
      expect(validateBaseURL("")).toEqual({ valid: true, error: null });
    });

    it("accepts http(s) URLs", () => {
      const { validateBaseURL } = loadValidators({});
      expect(validateBaseURL("https://api.example.com/v1")).toEqual({ valid: true, error: null });
      expect(validateBaseURL("http://localhost:11434/v1").valid).toBe(true);
    });

    it("rejects invalid URLs with an error message", () => {
      const { validateBaseURL } = loadValidators({});
      const result = validateBaseURL("not a url");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });
  });

  describe("DOM id consistency", () => {
    it("targets the lowercase baseurl error ids present in the view", () => {
      const { showFieldError, ids } = loadShowFieldError();
      showFieldError("add", "baseurl", "err");
      showFieldError("edit", "baseurl", "err");
      expect(ids).toContain("add-baseurl-error");
      expect(ids).toContain("edit-baseurl-error");
      expect(viewCode).toContain('id="add-baseurl-error"');
      expect(viewCode).toContain('id="edit-baseurl-error"');
    });

    it("targets the name/npm error ids present in the view", () => {
      const { showFieldError, ids } = loadShowFieldError();
      showFieldError("add", "name", "err");
      showFieldError("add", "npm", "err");
      expect(ids).toContain("add-name-error");
      expect(ids).toContain("add-npm-error");
      expect(viewCode).toContain('id="add-name-error"');
      expect(viewCode).toContain('id="add-npm-error"');
    });

    it("binds the add-modal apiKey input to validation", () => {
      const addApiKeyInput = viewCode.match(/<input[^>]*id="add-apikey"[^>]*>/)?.[0];
      expect(addApiKeyInput).toBeTruthy();
      expect(addApiKeyInput).toContain("oninput");
      expect(addApiKeyInput).toContain("apiKey");
    });
  });
});