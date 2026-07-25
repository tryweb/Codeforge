import type { FC, Child } from "hono/jsx";
import { html } from "hono/html";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "⊞" },
  { href: "/projects", label: "Projects", icon: "◰" },
  { href: "/separator", label: "", icon: "" },
  { href: "/auth/github", label: "GitHub Auth", icon: "◆" },
  { href: "/auth/gitlab", label: "GitLab Auth", icon: "◇" },
  { href: "/separator2", label: "", icon: "" },
  { href: "/git-config", label: "Git Config", icon: "⚡" },
  { href: "/ssh-keys", label: "SSH Keys", icon: "🔑" },
  { href: "/separator3", label: "", icon: "" },
  { href: "/versions", label: "Versions", icon: "↻" },
  { href: "/env", label: "Environment", icon: "⚙" },
  { href: "/upgrade", label: "Upgrade", icon: "▲" },
];

interface LayoutProps {
  title: string;
  children: Child;
  currentPath?: string;
}

export const Layout: FC<LayoutProps> = ({ title, children, currentPath }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} — ai-admin</title>
        <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
        <link rel="alternate icon" href="/static/favicon.ico" sizes="any" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/static/style.css" />
      </head>
      <body>
        <div class="app-layout">
          <aside class="sidebar">
            <div class="logo">
              <h1>ai-admin</h1>
              <div class="subtitle">AI-EngKit Dashboard</div>
            </div>
            <nav>
              {NAV_ITEMS.map((item) => (
                item.href.startsWith("/separator")
                  ? <div style="height:1px;background:var(--border);margin:8px 12px;" />
                  : <a
                      href={item.href}
                      class={(currentPath === item.href || (item.href !== "/" && currentPath?.startsWith(item.href)))
                        ? "active" : ""}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </a>
              ))}
              <a href="#" onclick="document.getElementById('about-modal').style.display='flex';return false;" style="margin-top:auto;">
                <span>🛈</span><span>About</span>
              </a>
              <a href="/api/logout" style="margin-top:8px;border-top:1px solid var(--border);padding-top:16px;">
                <span>⏻</span><span>Logout</span>
              </a>
            </nav>
          </aside>
          <main class="main-content">
            <div id="global-banner" />
            {children}
          </main>
        </div>
        <div id="about-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)this.style.display='none';">
          <div class="modal" style="max-width:400px;text-align:center;">
            <img src="/static/favicon.svg" alt="AI-EngKit" style="width:80px;height:80px;margin:0 auto 16px;" />
            <h2 style="margin-bottom:4px;">AI-EngKit</h2>
            <p class="text-muted" style="margin-bottom:16px;font-size:0.75rem;" id="about-version">ai-admin</p>
            <script>{html`
              fetch("/api/versions/image").then(r => r.json()).then(function(d) {
                var el = document.getElementById("about-version");
                if (el && d.version) el.textContent = "ai-admin v" + d.version;
              }).catch(function() {});
            `}</script>
            <p style="margin-bottom:20px;font-size:0.85rem;color:var(--text-muted);">Empowering AI builders to create, automate, and innovate.</p>
            <div class="flex gap-2" style="justify-content:center;margin-bottom:16px;">
              <a href="https://github.com/tryweb/ai-engkit" target="_blank" rel="noopener" class="btn-outline" style="text-decoration:none;font-size:0.85rem;">GitHub</a>
              <a href="https://discord.gg/ZcFTYTWvZ2" target="_blank" rel="noopener" class="btn-outline" style="text-decoration:none;font-size:0.85rem;">Discord</a>
            </div>
            <button class="btn-outline" onclick="document.getElementById('about-modal').style.display='none';">Close</button>
          </div>
        </div>
        <script src="/static/app.js" />
        <script src="/static/app.js" />
      </body>
    </html>
  );
};
