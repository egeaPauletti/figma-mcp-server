import express from "express";
import { rateLimit } from "express-rate-limit";
import type { FigmaOAuthProvider } from "./provider.js";
import { authenticate } from "./users.js";
import { renderLoginPage, renderMessagePage } from "./login-page.js";

// Handles the login form rendered by FigmaOAuthProvider.authorize().
export function loginRouter(provider: FigmaOAuthProvider): express.Router {
    const router = express.Router();

    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
            res.status(429).type("html").send(
                renderMessagePage("Muitas tentativas", "Aguarde alguns minutos antes de tentar entrar novamente.")
            );
        },
    });

    router.post("/oauth/login", limiter, express.urlencoded({ extended: false }), async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Frame-Options", "DENY");

        const requestId = typeof req.body?.request_id === "string" ? req.body.request_id : "";
        const email = typeof req.body?.email === "string" ? req.body.email : "";
        const password = typeof req.body?.password === "string" ? req.body.password : "";

        const pending = requestId ? provider.peekPendingAuthorization(requestId) : undefined;
        if (!pending) {
            res.status(400).type("html").send(
                renderMessagePage("Pedido expirado", "O pedido de autorização expirou. Volte ao seu cliente MCP e conecte novamente.")
            );
            return;
        }

        const client = await provider.clientsStore.getClient(pending.clientId);

        const user = email && password ? await authenticate(email, password) : undefined;
        if (!user) {
            res.status(401).type("html").send(
                renderLoginPage({ requestId, clientName: client?.client_name, email, error: "E-mail ou senha inválidos." })
            );
            return;
        }

        const consumed = provider.consumePendingAuthorization(requestId);
        if (!consumed) {
            res.status(400).type("html").send(
                renderMessagePage("Pedido expirado", "O pedido de autorização expirou. Volte ao seu cliente MCP e conecte novamente.")
            );
            return;
        }

        const code = provider.issueAuthorizationCode(consumed, user);
        const target = new URL(consumed.redirectUri);
        target.searchParams.set("code", code);
        if (consumed.state !== undefined) target.searchParams.set("state", consumed.state);
        res.redirect(302, target.href);
    });

    return router;
}
