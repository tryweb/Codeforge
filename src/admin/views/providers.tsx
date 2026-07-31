import { html, raw } from "hono/html";
import { Layout } from "./layout";

interface RegistryKeyView {
  id: string;
  masked: string;
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

export function ProvidersPage({
  meta,
  entries,
}: {
  meta: ProvidersMeta;
  entries: Record<string, unknown>;
}) {
  const reveal = html`
    <script>
      var providersEntries = ${raw(JSON.stringify(entries))};
      var providersMeta = ${raw(JSON.stringify(meta.providers))};
      var editName = null;
      var editState = null;
      var editApiKey = null;
      var editRawValid = true;

      function providerCard(name) {
        return document.querySelector('.provider-card[data-provider="' + name + '"]');
      }
      function providerMeta(name) {
        return providersMeta.find(function (p) { return p.name === name; });
      }

      function restartAiDev() {
        if (!confirm('Restart ai-dev container? OpenCode sessions may briefly disconnect.')) return;
        fetch('/api/env/restart', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) return location.reload();
            alert('Restart failed: ' + (j.error || 'unknown error'));
          });
      }

      function openProviderEdit(name) {
        editName = name;
        editApiKey = null;
        editRawValid = true;
        var e = JSON.parse(JSON.stringify(providersEntries[name] || {}));
        editState = e;
        document.getElementById('edit-name').value = name;
        document.getElementById('edit-label').value = e.name || '';
        document.getElementById('edit-npm').value = e.npm || '';
        document.getElementById('edit-baseurl').value = (e.options && e.options.baseURL) || '';
        document.getElementById('edit-apikey').value = '';
        document.getElementById('edit-raw').value = JSON.stringify(e, null, 2);
        document.getElementById('edit-status').textContent = '';
        document.getElementById('edit-modal').style.display = 'flex';
      }

      function patchField(field, value) {
        if (!editState) return;
        if (field === 'label') editState.name = value;
        else if (field === 'npm') editState.npm = value;
        else if (field === 'baseURL') { editState.options = editState.options || {}; editState.options.baseURL = value; }
        else if (field === 'apiKey') { editApiKey = value; return; }
        document.getElementById('edit-raw').value = JSON.stringify(editState, null, 2);
      }

      function onRawInput(text) {
        if (!editState) return;
        var s = document.getElementById('edit-status');
        try {
          editState = JSON.parse(text);
          editRawValid = true;
          s.textContent = '';
        } catch (err) {
          editRawValid = false;
          s.textContent = 'Raw JSON is invalid: ' + err.message;
        }
      }

      function saveProvider() {
        if (!editName) return;
        if (!editRawValid) return;
        if (editApiKey) {
          editState.options = editState.options || {};
          editState.options.apiKey = editApiKey;
        }
        fetch('/api/providers/' + editName, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: editState }),
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) return location.reload();
            alert('Save failed: ' + (j.error || 'unknown error'));
          });
      }

      function closeProviderEdit() {
        editName = null;
        document.getElementById('edit-modal').style.display = 'none';
      }

      function deleteProvider(name) {
        if (!confirm('Delete provider "' + name + '" from OPENCODE_PROVIDER?')) return;
        fetch('/api/providers/' + name, { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) return location.reload();
            alert('Delete failed: ' + (j.error || 'unknown error'));
          });
      }

      function addKey(name) {
        var input = providerCard(name).querySelector('.key-add-input');
        var value = input.value;
        if (!value) { input.focus(); return; }
        var pm = providerMeta(name);
        var first = pm && pm.registry.keyCount === 0;
        if (first && !confirm('This is the first key for ' + name + ' — it will be applied to the auth store and ai-dev will restart. Continue?')) return;
        fetch('/api/providers/' + name + '/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: value }),
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) return location.reload();
            alert('Add key failed: ' + (j.error || 'unknown error'));
          });
      }

      function deleteKey(name, keyId) {
        if (!confirm('Delete this API key?')) return;
        fetch('/api/providers/' + name + '/keys/' + keyId, { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) return location.reload();
            alert('Delete key failed: ' + (j.error || 'unknown error'));
          });
      }

      function selectActiveKey(name, keyId) {
        if (!confirm('Switching the active key writes it to the auth store and restarts ai-dev (brief downtime). Continue?')) return;
        fetch('/api/providers/' + name + '/keys/' + keyId + '/active', { method: 'PUT' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok) return location.reload();
            alert('Activate key failed: ' + (j.error || 'unknown error'));
          });
      }

      function toggleKeyValue(name, keyId, btn) {
        var row = btn.closest('.secret-value-row');
        var mv = row.querySelector('.masked-value');
        var revealed = mv.querySelector('.revealed');
        if (mv.classList.contains('show')) {
          mv.classList.remove('show');
          btn.textContent = 'Show';
          return;
        }
        fetch('/api/providers/' + name + '/keys/' + keyId + '/value')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j.ok) { alert('Failed to reveal key: ' + (j.error || 'unknown error')); return; }
            revealed.textContent = j.key;
            mv.classList.add('show');
            btn.textContent = 'Hide';
          });
      }

      function importKey(name) {
        fetch('/api/providers/' + name + '/import-candidate')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j.ok || !j.candidate) { alert('No key to import: ' + ((j.error) || 'auth store has no key for ' + name)); return; }
            if (!confirm('Import key ' + j.candidate.masked + ' as the first key for ' + name + '? ai-dev will restart.')) return;
            return fetch('/api/providers/' + name + '/import', { method: 'POST' })
              .then(function (r) { return r.json(); })
              .then(function (j2) {
                if (j2.ok) return location.reload();
                alert('Import failed: ' + (j2.error || 'unknown error'));
              });
          });
      }
    </script>
  `;

  return (
    <Layout title="Providers">
      <div class="flex items-center justify-between mb-4">
        <h2>Providers</h2>
        <button class="btn-outline" onclick="restartAiDev()">Restart ai-dev</button>
      </div>
      <p class="text-sm text-muted" style="margin-bottom: 16px;">
        Providers are defined in <code>OPENCODE_PROVIDER</code> and injected into <code>opencode.json</code> on startup.
        Key-managed providers (Opencode Go) keep their API keys in the provider-keys registry instead; the active key is
        written to the opencode auth store and applied on restart.
      </p>
      {meta.invalid && (
        <div class="card danger-card" style="margin-bottom: 16px;">
          <b>OPENCODE_PROVIDER is not valid JSON:</b> {meta.error} — fix it in the{" "}
          <a href="/env">Environment editor</a> or via the raw JSON editor below.
        </div>
      )}
      {meta.providers.length === 0 && !meta.invalid && (
        <div class="card" style="margin-bottom: 16px;">
          No providers configured yet.
        </div>
      )}
      {meta.providers.map((p) => (
        <div class="card secret-card provider-card" data-provider={p.name} style="margin-bottom: 16px;">
          <div class="flex" style="justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
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
              <div class="flex" style="justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <b style="font-size: 14px;">API Keys ({p.registry.keyCount})</b>
                <span class="badge badge-warning">
                  {p.authStoreKeyPresent ? "auth store: key present" : "auth store: no key"}
                </span>
              </div>
              {p.registry.keys.length === 0 && (
                <div class="text-muted" style="font-size: 13px; margin-bottom: 8px;">
                  No keys stored. Add one below, or import the key already present in the auth store.
                </div>
              )}
              {p.registry.keys.map((k) => (
                <div class="secret-value-row" data-key-id={k.id} style="margin-bottom: 8px;">
                  <input
                    type="radio"
                    name={`active-${p.name}`}
                    checked={k.active}
                    onclick={`selectActiveKey('${p.name}', '${k.id}')`}
                    style="margin-right: 8px;"
                  />
                  <span class="masked-value">
                    <span class="masked">{k.masked}</span>
                    <span class="revealed"></span>
                  </span>
                  <button class="btn-outline" onclick={`toggleKeyValue('${p.name}', '${k.id}', this)`} style="margin-left: auto;">
                    Show
                  </button>
                  <button class="btn-outline" onclick={`deleteKey('${p.name}', '${k.id}')`}>Delete</button>
                </div>
              ))}
              <div class="flex" style="gap: 8px; align-items: center;">
                <input type="password" class="key-add-input" placeholder="New API key" autocomplete="new-password" />
                <button class="btn-outline" onclick={`addKey('${p.name}')`}>Add key</button>
                {p.registry.keyCount === 0 && (
                  <button class="btn-outline" onclick={`importKey('${p.name}')`}>Import from auth store</button>
                )}
              </div>
            </div>
          )}
          <div class="flex" style="justify-content: space-between; align-items: center; gap: 8px;">
            <span class="badge badge-warning">Restart required to apply</span>
            <div class="flex" style="gap: 8px;">
              {!p.virtual && (
                <button class="btn-outline" onclick={`openProviderEdit('${p.name}')`}>Edit</button>
              )}
              {!p.virtual && (
                <button class="btn-outline" onclick={`deleteProvider('${p.name}')`}>Delete</button>
              )}
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
            <label>npm package</label>
            <input type="text" id="edit-npm" oninput="patchField('npm', this.value)" />
          </div>
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" id="edit-baseurl" oninput="patchField('baseURL', this.value)" placeholder="https://…" />
          </div>
          <div class="form-group">
            <label>
              API key <span class="text-muted" style="font-size: 12px;">(leave empty to keep existing)</span>
            </label>
            <input type="password" id="edit-apikey" oninput="patchField('apiKey', this.value)" autocomplete="new-password" />
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
      {reveal}
    </Layout>
  );
}
