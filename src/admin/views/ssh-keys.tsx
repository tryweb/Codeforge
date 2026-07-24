import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Layout } from "./layout";

interface SshKey {
  name: string;
  fingerprint: string;
  type: string;
}

const SshKeysContent: FC<{ keys: SshKey[] }> = ({ keys }) => (
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2>SSH Keys</h2>
      <button onclick="showGenerateForm()" class="btn-outline">+ Generate Key</button>
    </div>
    <div class="card">
      <table>
        <tr><th>Name</th><th>Type</th><th>Fingerprint</th><th></th><th></th></tr>
        {keys.map(k => (
          <tr>
            <td><code>{k.name}</code></td>
            <td>{k.type}</td>
            <td><code>{k.fingerprint}</code></td>
            <td><button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick={`showPubKey('${k.name}')`}>Public Key</button></td>
            <td style="position:relative;text-align:center;">
              <button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" data-deploy-name={k.name} onclick={`toggleDeploy('${k.name}')`}>Deploy</button>
              <div id={`deploy-popup-${k.name}`} class="deploy-popup" style="display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:4px;background:var(--bg-card,#fff);border:1px solid var(--border,#d0d0d0);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:100;white-space:nowrap;">
                <button onclick={`copyDeploy('${k.name}','linux')`} style="display:block;width:100%;padding:8px 16px;border:none;background:none;cursor:pointer;font-size:0.8rem;text-align:left;border-radius:6px 6px 0 0;">&#x1F427; Linux</button>
                <button onclick={`copyDeploy('${k.name}','windows')`} style="display:block;width:100%;padding:8px 16px;border:none;background:none;cursor:pointer;font-size:0.8rem;text-align:left;border-radius:0 0 6px 6px;">&#x1FA9F; Windows</button>
              </div>
            </td>
          </tr>
        ))}
        {keys.length === 0 && <tr><td colspan="5" class="text-muted">No SSH keys found</td></tr>}
      </table>
    </div>
    <div id="generate-modal" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3>Generate SSH Key</h3>
        <div class="form-group"><label>Key Name</label><input type="text" id="key-name" placeholder="id_ed25519" /></div>
        <div class="form-group"><label>Type</label>
          <select id="key-type"><option value="ed25519">Ed25519</option><option value="rsa">RSA 4096</option></select>
        </div>
        <div class="form-group"><label>Passphrase (optional)</label><input type="password" id="key-passphrase" /></div>
        <div id="gen-error" class="text-sm text-danger" style="display:none;margin-bottom:8px;" />
        <div class="flex gap-2" style="justify-content:flex-end;">
          <button class="btn-outline" onclick="closeGenerate()">Cancel</button>
          <button onclick="generateKey()">Generate</button>
        </div>
      </div>
    </div>
    <div id="pubkey-modal" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3>Public Key</h3>
        <pre id="pubkey-content" style="user-select:all;" />
        <div class="flex gap-2" style="justify-content:flex-end;margin-top:12px;">
          <button onclick="copyPubKey()">Copy</button>
          <button class="btn-outline" onclick="closePubKey()">Close</button>
        </div>
      </div>
    </div>
    <script>{html`
      function showGenerateForm() { document.getElementById("generate-modal").style.display = "flex"; }
      function closeGenerate() { document.getElementById("generate-modal").style.display = "none"; }
      async function generateKey() {
        const name = document.getElementById("key-name").value.trim() || "id_ed25519";
        const type = document.getElementById("key-type").value;
        const passphrase = document.getElementById("key-passphrase").value;
        const res = await fetch("/api/ssh/keys", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, type, passphrase }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); document.getElementById("gen-error").style.display = "block";
          document.getElementById("gen-error").textContent = d.error || "Failed to generate"; }
      }
      async function showPubKey(name) {
        const res = await fetch("/api/ssh/keys/" + encodeURIComponent(name) + "/pub");
        if (res.ok) {
          document.getElementById("pubkey-content").textContent = await res.text();
          document.getElementById("pubkey-modal").style.display = "flex";
        } else { alert("Failed to load public key"); }
      }
      function closePubKey() { document.getElementById("pubkey-modal").style.display = "none"; }
      async function copyDeploy(name, os) {
        const popup = document.getElementById("deploy-popup-" + name);
        popup.style.display = "none";
        const res = await fetch("/api/ssh/keys/" + encodeURIComponent(name) + "/pub");
        if (!res.ok) { alert("Failed to load public key"); return; }
        const pubkey = (await res.text()).trim();
        let cmd;
        if (os === "linux") {
          cmd = "mkdir -p ~/.ssh && echo '" + pubkey + "' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && echo 'SSH key deployed'";
        } else {
          cmd = "$d=\\\"$env:USERPROFILE\\\\.ssh\\\"; if(!(Test-Path $d)){mkdir $d|out-null}; Add-Content $d\\\\authorized_keys '" + pubkey + "'; icacls $d\\\\authorized_keys /inheritance:r /grant \\\"$env:USERNAME:(R)\\\" 2>$null; Write-Host 'SSH key deployed'";
        }
        try { await navigator.clipboard.writeText(cmd); } catch {
          const ta = document.createElement("textarea"); ta.value = cmd;
          ta.style.position = "fixed"; ta.style.left = "-9999px";
          document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        }
        const btn = document.querySelector("[data-deploy-name=\\\"" + name + "\\\"]");
        const orig = btn.textContent;
        btn.textContent = "\u2713 Copied!";
        setTimeout(function() { btn.textContent = orig; }, 2000);
      }
      function toggleDeploy(name) {
        var popup = document.getElementById("deploy-popup-" + name);
        var isVisible = popup.style.display === "block";
        document.querySelectorAll(".deploy-popup").forEach(function(el) { el.style.display = "none"; });
        popup.style.display = isVisible ? "none" : "block";
      }
      document.addEventListener("click", function(e) {
        if (!e.target.closest("[data-deploy-name]") && !e.target.closest(".deploy-popup")) {
          document.querySelectorAll(".deploy-popup").forEach(function(el) { el.style.display = "none"; });
        }
      });
      async function copyPubKey() {
        const el = document.getElementById("pubkey-content");
        const text = el.textContent;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        el.textContent = text + "  \u2713 Copied!";
        setTimeout(() => { el.textContent = text; }, 1500);
      }
    `}</script>
  </div>
);

export function SshKeysPage(keys: SshKey[]) {
  return (
    <Layout title="SSH Keys" currentPath="/ssh-keys">
      <SshKeysContent keys={keys} />
    </Layout>
  );
}
