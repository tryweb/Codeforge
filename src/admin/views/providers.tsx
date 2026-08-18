import { html, raw } from "hono/html";
import { Layout } from "./layout";

interface RegistryKeyView {
  id: string;
  masked: string;
  note: string;
  active: boolean;
}

interface ProviderMetaView {
  name: string;
  label: string;
  npm: string;
  baseURL: string;
  hasApiKey: boolean;
  keyManagement: boolean;
  authStoreKeyPresent: boolean;
  oauthManaged: boolean;
  oauthConnected: boolean;
  virtual: boolean;
  registry: {
    keyCount: number;
    activeKeyId: string | null;
    keys: RegistryKeyView[];
  };
}

interface ProvidersMeta {
  invalid: boolean;
  error: string | null;
  providers: ProviderMetaView[];
}

const OPENAI_VERIFY_URL = "https://auth.openai.com/codex/device";

export function ProvidersPage({
  meta,
  entries,
}: {
  meta: ProvidersMeta;
  entries: Record<string, unknown>;
}) {
  const boot = html`<script>
    window.providersBoot = {
      entries: ${raw(JSON.stringify(entries))},
      meta: ${raw(JSON.stringify(meta.providers).replace(/</g, "\\u003c"))}
    };
  </script>`;

  return (
    <Layout title="Providers">
      <div class="flex items-center justify-between mb-4">
        <h2>Providers</h2>
        <div class="flex" style="gap: 8px;">
          <button class="btn" onclick="openAddProvider()">Add Provider</button>
          <button class="btn-outline" onclick="restartAiDev()">Restart ai-dev</button>
        </div>
      </div>
      <p class="text-sm text-muted" style="margin-bottom: 16px;">
        Providers are defined in <code>OPENCODE_PROVIDER</code> and injected into <code>opencode.json</code> on startup.
        Key-managed providers (Opencode Go, OpenAI API) keep their API keys in the provider-keys registry instead;
        the registry-selected key is written to the opencode auth store and applied on restart.
      </p>
      {meta.invalid && (
        <div class="card danger-card" style="margin-bottom: 16px;">
          <b>OPENCODE_PROVIDER is not valid JSON:</b> {meta.error} — fix it in the{" "}
          <a href="/env">Environment editor</a> or via the raw JSON editor below.
        </div>
      )}
      {meta.providers.length === 0 && !meta.invalid && (
        <div class="card" style="margin-bottom: 16px;">
          <p style="margin-bottom: 12px;">No providers configured yet.</p>
          <button class="btn" onclick="openAddProvider()">Add Provider</button>
        </div>
      )}
      {meta.providers.map((p) => (
        <div class="card secret-card provider-card" data-provider={p.name} style="margin-bottom: 16px;">
          <div class="flex" style="justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h3 style="margin: 0;">{p.label}</h3>
              {p.virtual && <span class="badge badge-warning">auth-managed</span>}
              {p.npm && <span class="text-muted" style="font-size: 13px;">{p.npm}</span>}
            </div>
          </div>
          {!p.virtual && (
            <div class="flex" style="gap: 32px; margin-bottom: 12px; flex-wrap: wrap;">
              <div>
                <div class="text-muted" style="font-size: 13px;">Base URL</div>
                <div>{p.baseURL || "—"}</div>
              </div>
              <div>
                <div class="text-muted" style="font-size: 13px;">API Key</div>
                <div>{p.hasApiKey ? <span class="badge badge-success">set</span> : "—"}</div>
              </div>
            </div>
          )}
          {p.keyManagement && (
            <div style="margin-bottom: 12px;">
              <div class="flex" style="justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; flex-wrap: wrap;">
                <div>
                  <b style="font-size: 14px;">{p.label} keys in registry ({p.registry.keyCount})</b>
                  <span class="key-activation-status text-muted" style="font-size: 13px; margin-left: 8px;"></span>
                </div>
                <span class="badge badge-warning">
                  {p.authStoreKeyPresent ? "auth store: API key present" : "auth store: no API key"}
                </span>
              </div>
              {p.registry.keys.length === 0 && (
                <div class="text-muted" style="font-size: 13px; margin-bottom: 8px;">
                  No keys stored. Add one below, or import the key already present in the auth store.
                </div>
              )}
              {p.registry.keys.map((k) => (
                <div class="key-row" data-key-id={k.id}>
                  <input
                    type="radio"
                    class="key-row__select"
                    name={`active-${p.name}`}
                    checked={k.active}
                    onclick={`selectActiveKey('${p.name}', '${k.id}')`}
                    aria-label={`Select ${k.masked} as the active key`}
                  />
                  <span class="masked-value key-row__value" title={k.masked}>
                    <span class="masked">{k.masked}</span>
                    <span class="revealed"></span>
                  </span>
                  {k.active && <span class="badge badge-warning">Selected in registry</span>}
                  <input
                    type="text"
                    class="key-note-input key-row__note"
                    value={k.note}
                    placeholder="Note"
                    aria-label={`Note for ${k.masked}`}
                  />
                  <span class="key-row__actions">
                    <button class="btn-outline" onclick={`saveKeyNote('${p.name}', '${k.id}', this)`}>
                      Save
                    </button>
                    <button class="btn-outline" onclick={`toggleKeyValue('${p.name}', '${k.id}', this)`}>Show</button>
                    <button class="btn-outline" onclick={`deleteKey('${p.name}', '${k.id}')`}>Delete</button>
                  </span>
                </div>
              ))}
              <div class="key-add-row">
                <input type="password" class="key-add-input" placeholder="New API key" autocomplete="new-password" />
                <input type="text" class="key-add-note-input" placeholder="Note (optional)" />
                <button class="btn-outline" onclick={`addKey('${p.name}')`}>Add key</button>
                {p.registry.keyCount === 0 && (
                  <button class="btn-outline" onclick={`importKey('${p.name}')`}>Import from auth store</button>
                )}
              </div>
            </div>
          )}
          {p.oauthManaged && (
            <div class="oauth-panel" data-provider={p.name} data-connected={p.oauthConnected ? "true" : "false"}>
              <div class="flex" style="justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; flex-wrap: wrap;">
                <div>
                  <b style="font-size: 14px;">ChatGPT Pro/Plus</b>
                  {p.oauthConnected && <span class="badge badge-success" style="margin-left: 8px;">OAuth connected</span>}
                </div>
                {p.oauthConnected ? (
                  <button class="btn-danger" onclick={`disconnectOAuth('${p.name}')`}>Disconnect ChatGPT</button>
                ) : (
                  <button class="btn" onclick={`startOAuth('${p.name}')`}>Connect ChatGPT Pro/Plus</button>
                )}
              </div>
              <p class="text-sm text-muted">
                {p.oauthConnected
                  ? "OpenAI models run through your ChatGPT Pro/Plus subscription — no API key needed."
                  : `Prerequisites: an active ChatGPT Pro or Plus subscription. You will be shown a code and asked to enter it at ${OPENAI_VERIFY_URL}. Connecting replaces any stored OpenAI API key credential.`}
              </p>
              <div id="oauth-flow" class="oauth-flow" hidden>
                <div class="oauth-code-display">
                  <span class="text-muted text-sm">Code</span>
                  <div class="oauth-code" id="oauth-user-code"></div>
                </div>
                <p class="text-sm" style="margin: 8px 0;">
                  Open <a id="oauth-verify-link" href={OPENAI_VERIFY_URL} target="_blank" rel="noopener noreferrer">auth.openai.com/codex/device</a> and enter the code above.
                </p>
                <div id="oauth-poll-status" class="text-sm text-muted" style="margin-bottom: 8px;"></div>
                <div class="flex" style="gap: 8px;">
                  <button class="btn-outline" onclick="cancelOAuth()">Cancel</button>
                  <button id="oauth-apply" class="btn" onclick="applyOAuth()" hidden>Finish connecting</button>
                </div>
              </div>
            </div>
          )}
          <div class="flex" style="justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="badge badge-warning">Restart required to apply</span>
            <div class="flex" style="gap: 8px;">
              {!p.virtual && <button class="btn-outline" onclick={`openProviderEdit('${p.name}')`}>Edit</button>}
              {!p.virtual && <button class="btn-outline" onclick={`deleteProvider('${p.name}')`}>Delete</button>}
            </div>
          </div>
        </div>
      ))}

      <div id="edit-modal" class="modal-overlay" style="display: none;">
        <div class="modal" style="max-width: 560px;">
          <h3 style="margin-top: 0;">Edit Provider</h3>
          <div class="form-group">
            <label>Provider name (key)</label>
            <input type="text" id="edit-name" readonly />
          </div>
          <div class="form-group">
            <label>Display name</label>
            <input type="text" id="edit-label" oninput="patchField('label', this.value)" />
          </div>
          <div class="form-group">
            <label>npm package <span class="text-danger">*</span></label>
            <input type="text" id="edit-npm" oninput="patchField('npm', this.value)" placeholder="@ai-sdk/openai-compatible" />
            <div id="edit-npm-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" id="edit-baseurl" oninput="patchField('baseURL', this.value)" placeholder="https://…" />
            <div id="edit-baseurl-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>
              API key <span class="text-muted" style="font-size: 12px;">(leave empty to keep existing)</span>
            </label>
            <input type="password" id="edit-apikey" oninput="patchField('apiKey', this.value)" autocomplete="new-password" />
            <div id="edit-apikey-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>Raw JSON (authoritative)</label>
            <textarea
              id="edit-raw"
              rows={8}
              spellcheck={false}
              oninput="onRawInput(this.value)"
              style="width: 100%; font-family: var(--font-mono); font-size: 13px;"
            />
          </div>
          <div id="edit-status" class="text-muted" style="font-size: 13px; margin-bottom: 8px;"></div>
          <div class="flex" style="justify-content: flex-end; gap: 8px;">
            <button class="btn-outline" onclick="closeProviderEdit()">Cancel</button>
            <button onclick="saveProvider()">Save</button>
          </div>
        </div>
      </div>

      <div id="add-modal" class="modal-overlay" style="display: none;">
        <div class="modal" style="max-width: 560px;">
          <h3 style="margin-top: 0;">Add Provider</h3>
          <div class="form-group">
            <label>Provider name (key) <span class="text-danger">*</span></label>
            <input type="text" id="add-name" oninput="validateAddField('name', this.value)" placeholder="my-provider" />
            <div id="add-name-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>Display name</label>
            <input type="text" id="add-label" oninput="validateAddField('label', this.value)" placeholder="My Provider" />
          </div>
          <div class="form-group">
            <label>npm package <span class="text-danger">*</span></label>
            <input type="text" id="add-npm" oninput="validateAddField('npm', this.value)" placeholder="@ai-sdk/openai-compatible" />
            <div id="add-npm-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>Base URL <span class="text-danger">*</span></label>
            <input type="text" id="add-baseurl" oninput="validateAddField('baseURL', this.value)" placeholder="https://api.example.com/v1" />
            <div id="add-baseurl-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>API key</label>
            <input type="password" id="add-apikey" oninput="validateAddField('apiKey', this.value)" autocomplete="new-password" />
            <div id="add-apikey-error" class="text-danger" style="font-size: 12px; margin-top: 4px; display: none;"></div>
          </div>
          <div class="form-group">
            <label>Raw JSON (authoritative)</label>
            <textarea
              id="add-raw"
              rows={8}
              spellcheck={false}
              oninput="onAddRawInput(this.value)"
              style="width: 100%; font-family: var(--font-mono); font-size: 13px;"
            />
          </div>
          <div id="add-status" class="text-muted" style="font-size: 13px; margin-bottom: 8px;"></div>
          <div class="flex" style="justify-content: flex-end; gap: 8px;">
            <button class="btn-outline" onclick="closeAddProvider()">Cancel</button>
            <button onclick="saveNewProvider()">Add Provider</button>
          </div>
        </div>
      </div>
      {boot}
      <script src="/static/providers-page.js"></script>
    </Layout>
  );
}
