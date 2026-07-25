import type { FC, Child } from "hono/jsx";

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
              <div class="subtitle">ai-engkit Dashboard</div>
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
              <a href="https://github.com/tryweb/ai-engkit" target="_blank" rel="noopener" style="margin-top:auto;">
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
        <div class="toast-container" id="toasts" />
        <script src="/static/app.js" />
      </body>
    </html>
  );
};
