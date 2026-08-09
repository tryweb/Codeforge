import { describe, expect, it } from "bun:test";
import { ProvidersPage } from "./providers";

describe("ProvidersPage key notes", () => {
  it("renders existing notes and note editing controls", () => {
    const page = ProvidersPage({
      meta: {
        invalid: false,
        error: null,
        providers: [
          {
            name: "opencode-go",
            label: "Opencode Go",
            npm: "",
            baseURL: "",
            hasApiKey: false,
            keyManagement: true,
            authStoreKeyPresent: true,
            virtual: true,
            registry: {
              keyCount: 1,
              activeKeyId: "k-1",
              keys: [{ id: "k-1", masked: "sk-…1234", note: "team A", active: true }],
            },
          },
        ],
      },
      entries: {},
    });

    const html = String(page);
    expect(html).toContain('value="team A"');
    expect(html).toContain("class=\"key-add-note-input\"");
    expect(html).toContain("/api/providers/' + name + '/keys/' + keyId");
  });
});
