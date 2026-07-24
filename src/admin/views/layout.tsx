import type { FC, Child } from "hono/jsx";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "⊞" },
  { href: "/versions", label: "Versions", icon: "↻" },
  { href: "/env", label: "Environment", icon: "⚙" },
  { href: "/upgrade", label: "Upgrade", icon: "▲" },
  { href: "/projects", label: "Projects", icon: "◰" },
  { href: "/auth/github", label: "GitHub Auth", icon: "◆" },
  { href: "/auth/gitlab", label: "GitLab Auth", icon: "◇" },
  { href: "/git-config", label: "Git Config", icon: "⚡" },
  { href: "/ssh-keys", label: "SSH Keys", icon: "🔑" },
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
                <a
                  href={item.href}
                  class={(currentPath === item.href || (item.href !== "/" && currentPath?.startsWith(item.href)))
                    ? "active" : ""}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              ))}
              <a href="/api/logout" style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">
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
