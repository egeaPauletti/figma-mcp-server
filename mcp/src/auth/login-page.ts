import { escapeHtml } from "../utils.js";

export interface LoginPageOptions {
    requestId: string;
    clientName?: string | undefined;
    email?: string | undefined;
    error?: string | undefined;
}

export function renderLoginPage({ requestId, clientName, email, error }: LoginPageOptions): string {
    const client = clientName ? escapeHtml(clientName) : "um cliente MCP";
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar - Figma MCP</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f5f7; --card:#fff; --fg:#111; --muted:#666; --border:#d0d0d5; --accent:#0d99ff; --err:#d92d20; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111214; --card:#1c1d20; --fg:#f2f2f2; --muted:#a0a0a8; --border:#34353a; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding:16px; }
  main { width:100%; max-width:360px; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:28px; }
  h1 { font-size:20px; margin:0 0 4px; }
  p { margin:0 0 20px; color:var(--muted); font-size:14px; }
  label { display:block; font-size:13px; font-weight:600; margin:14px 0 6px; }
  input { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:transparent; color:inherit; font:inherit; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { margin-top:22px; width:100%; padding:11px; border:0; border-radius:8px; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  .error { color:var(--err); font-size:14px; margin:0 0 8px; }
</style>
</head>
<body>
<main>
  <h1>Figma MCP</h1>
  <p>Entre para autorizar <strong>${client}</strong> a acessar o servidor.</p>
  ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}
  <form method="post" action="/oauth/login">
    <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
    <label for="email">E-mail</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus value="${email ? escapeHtml(email) : ""}">
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Entrar e autorizar</button>
  </form>
</main>
</body>
</html>`;
}

export function renderMessagePage(title: string, message: string): string {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;background:Canvas;color:CanvasText}main{max-width:420px}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}
