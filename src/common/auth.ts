import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import {createServer} from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {AppError} from "./errors.js";
import {positiveInteger} from "./validation.js";
import {type AuthConfig, safeUrl} from "./config.js";
import {object, requestJson} from "./http.js";
import {credentialContext, type Store, type Tokens} from "./credentials.js";

const exec = promisify(execFile);

export async function openBrowser(url: string, signal?: AbortSignal) {
    try {
        if (process.platform === "darwin")
            await exec("open", [url], {signal, timeout: 10000});
        else if (process.platform === "win32")
            await exec("rundll32", ["url.dll,FileProtocolHandler", url], {
                signal,
                timeout: 10000,
            });
        else await exec("xdg-open", [url], {signal, timeout: 10000});
    } catch {
        throw new AppError(
            "AUTH",
            "Cannot open a browser; retry login with --no-browser",
        );
    }
}

interface Metadata {
    authorization_endpoint: string;
    token_endpoint: string;
    revocation_endpoint?: string;
}

export class Auth {
    constructor(
        private config: AuthConfig,
        private store: Store,
        private launch: (
            url: string,
            signal?: AbortSignal,
        ) => Promise<void> = openBrowser,
    ) {
    }

    async login() {
        const callbackPort =
            this.config.callbackPort === undefined
                ? 0
                : positiveInteger(
                    String(this.config.callbackPort),
                    "CLERK_OAUTH_CALLBACK_PORT",
                    65535,
                );
        const metadata = await this.metadata();
        const state = randomBytes(32).toString("base64url");
        const verifier = randomBytes(32).toString("base64url");
        let finish: (code: string) => void = () => {
        };
        let fail: (error: Error) => void = () => {
        };
        const received = new Promise<string>((resolve, reject) => {
            finish = resolve;
            fail = reject;
        });
        // Attach a handler immediately; callbacks can complete before browser launch resolves.
        void received.catch(() => {
        });
        const browserController = new AbortController();
        let completed = false;
        const server = createServer((req, res) => {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "text/plain");
            res.setHeader("Referrer-Policy", "no-referrer");
            let url: URL;
            try {
                url = new URL(req.url ?? "/", "http://127.0.0.1");
            } catch {
                res.statusCode = 400;
                res.end("Invalid callback URL");
                return;
            }
            if (completed) {
                res.statusCode = 410;
                res.end("Callback already used");
                return;
            }
            if (req.method !== "GET" || url.pathname !== "/callback") {
                res.statusCode = 404;
                res.end("Not found");
                return;
            }
            const returned = url.searchParams.get("state") ?? "";
            if (
                url.searchParams.getAll("state").length !== 1 ||
                Buffer.byteLength(returned) !== Buffer.byteLength(state) ||
                !timingSafeEqual(Buffer.from(returned), Buffer.from(state))
            ) {
                res.statusCode = 400;
                res.end("Invalid OAuth state");
                return;
            }
            completed = true;
            if (url.searchParams.has("error")) {
                // Only allow known protocol codes into diagnostics. Provider descriptions
                // and arbitrary error strings can contain credentials or personal data.
                const hints: Record<string, string> = {
                    invalid_scope:
                        "Check that the requested CLERK_OAUTH_SCOPES are enabled for this OAuth application",
                    access_denied: "The user or authorization server denied consent",
                    unauthorized_client:
                        "Check the OAuth application's Public setting and authorization-code permissions",
                    invalid_request:
                        "Check the OAuth application, requested scopes, PKCE settings and registered Redirect URI",
                    unsupported_response_type:
                        "The OAuth application must allow authorization-code login",
                    invalid_client:
                        "Check CLERK_OAUTH_CLIENT_ID and that it belongs to the configured Clerk instance",
                    login_required: "Sign in to Clerk and retry",
                    consent_required: "Grant the requested application consent and retry",
                    interaction_required: "Complete the browser sign-in and consent flow",
                    server_error:
                        "The authorization server failed; retry or inspect its logs",
                    temporarily_unavailable:
                        "The authorization server is temporarily unavailable; retry later",
                };
                const code =
                    url.searchParams.getAll("error").length === 1
                        ? url.searchParams.get("error")!
                        : "";
                const hint = Object.hasOwn(hints, code) ? hints[code] : undefined;
                const message = hint
                    ? `OAuth authorization failed: ${code}. ${hint}`
                    : "OAuth authorization was denied or invalid";
                res.statusCode = 400;
                res.end("Authentication failed. See the CLI diagnostic.");
                fail(new AppError("AUTH", message));
                return;
            }
            if (
                url.searchParams.has("access_token") ||
                url.searchParams.getAll("code").length !== 1 ||
                !url.searchParams.get("code")
            ) {
                res.statusCode = 400;
                res.end("Authentication failed");
                fail(
                    new AppError(
                        "AUTH",
                        "OAuth callback did not contain a valid authorization-code response",
                    ),
                );
                return;
            }
            res.end("Authentication complete. You may close this window.");
            finish(url.searchParams.get("code")!);
        });
        let timer: NodeJS.Timeout | undefined;
        const cancel = () => fail(new AppError("AUTH", "Login cancelled"));
        try {
            await new Promise<void>((resolve, reject) => {
                const bindError = () =>
                    reject(
                        new AppError(
                            "AUTH",
                            `Cannot bind OAuth callback on 127.0.0.1${callbackPort ? `:${callbackPort}` : ""}; free the port or change CLERK_OAUTH_CALLBACK_PORT and the registered Redirect URI`,
                        ),
                    );
                server.once("error", bindError);
                server.listen(callbackPort, "127.0.0.1", () => {
                    server.off("error", bindError);
                    resolve();
                });
            });
            const address = server.address();
            if (!address || typeof address === "string")
                throw new AppError("AUTH", "Cannot start OAuth callback");
            const redirect = `http://127.0.0.1:${address.port}/callback`;
            const url = new URL(metadata.authorization_endpoint);
            for (const [key, value] of Object.entries({
                response_type: "code",
                client_id: this.config.clientId!,
                redirect_uri: redirect,
                state,
                scope: this.config.scopes ?? "openid profile",
                code_challenge: createHash("sha256")
                    .update(verifier)
                    .digest("base64url"),
                code_challenge_method: "S256",
                ...(this.config.audience ? {audience: this.config.audience} : {}),
            }))
                url.searchParams.set(key, value);
            timer = setTimeout(
                () => fail(new AppError("AUTH", "OAuth login timed out")),
                this.config.loginTimeoutMs ?? 180000,
            );
            process.once("SIGINT", cancel);
            process.once("SIGTERM", cancel);
            // Race browser launch too, so a stuck desktop opener cannot defeat login timeout.
            const code = await Promise.race([
                this.launch(url.href, browserController.signal).then(() => received),
                received,
            ]);
            await this.exchange(metadata.token_endpoint, {
                grant_type: "authorization_code",
                code,
                redirect_uri: redirect,
                code_verifier: verifier,
            });
            return {authenticated: true};
        } finally {
            browserController.abort();
            clearTimeout(timer);
            process.off("SIGINT", cancel);
            process.off("SIGTERM", cancel);
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
        }
    }

    async token() {
        const tokens = await this.store.read();
        if (!tokens)
            throw new AppError(
                "AUTH",
                "Not authenticated; run vehicle-cli auth login",
            );
        if (tokens.expiresAt > Date.now() + 30000) return tokens.accessToken;
        if (!tokens.refreshToken)
            throw new AppError(
                "AUTH",
                "Credentials expired; run vehicle-cli auth login",
            );
        const metadata = await this.metadata();
        return (
            await this.exchange(
                metadata.token_endpoint,
                {grant_type: "refresh_token", refresh_token: tokens.refreshToken},
                tokens,
            )
        ).accessToken;
    }

    async status() {
        const tokens = await this.store.read();
        return {
            authenticated: !!tokens && tokens.expiresAt > Date.now(),
            ...(tokens
                ? {
                    expiresAt: new Date(tokens.expiresAt).toISOString(),
                    refreshAvailable: !!tokens.refreshToken,
                }
                : {}),
        };
    }

    async logout() {
        let revoked = false;
        try {
            const tokens = await this.store.read();
            if (tokens) {
                const metadata = await this.metadata();
                if (metadata.revocation_endpoint) {
                    for (const [token, token_type_hint] of [
                        [tokens.refreshToken, "refresh_token"],
                        [tokens.accessToken, "access_token"],
                    ]) {
                        if (token)
                            await requestJson(
                                metadata.revocation_endpoint,
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/x-www-form-urlencoded",
                                    },
                                    body: new URLSearchParams({
                                        token,
                                        token_type_hint: token_type_hint!,
                                        client_id: this.config.clientId!,
                                    }),
                                },
                                this.timeout(),
                                true,
                            );
                    }
                    revoked = true;
                }
            }
        } finally {
            await this.store.clear();
        }
        return {authenticated: false, revoked};
    }

    private timeout() {
        return this.config.timeoutMs ?? 10000;
    }

    private context() {
        return credentialContext(this.config.issuer, this.config.clientId);
    }

    private async metadata(): Promise<Metadata> {
        if (!this.config.issuer || !this.config.clientId)
            throw new AppError(
                "AUTH",
                "Set CLERK_OAUTH_ISSUER and CLERK_OAUTH_CLIENT_ID",
            );
        const issuer = safeUrl(this.config.issuer, "CLERK_OAUTH_ISSUER");
        if (issuer.search)
            throw new AppError(
                "VALIDATION",
                "OAuth issuer must not have query parameters",
            );
        const base = issuer.href.replace(/\/$/, "");
        const data = await requestJson(
            `${base}/.well-known/oauth-authorization-server`,
            {},
            this.timeout(),
            true,
        );
        if (
            !object(data) ||
            data.issuer !== base ||
            typeof data.authorization_endpoint !== "string" ||
            typeof data.token_endpoint !== "string"
        )
            throw new AppError("AUTH", "Invalid OAuth discovery metadata");
        for (const key of [
            "authorization_endpoint",
            "token_endpoint",
            "revocation_endpoint",
        ]) {
            if (data[key] !== undefined) {
                if (typeof data[key] !== "string")
                    throw new AppError("AUTH", "Invalid OAuth discovery endpoint");
                safeUrl(data[key] as string, "OAuth endpoint");
            }
        }
        return data as unknown as Metadata;
    }

    private async exchange(
        endpoint: string,
        fields: Record<string, string>,
        previous?: Tokens,
    ): Promise<Tokens> {
        const body = new URLSearchParams({
            ...fields,
            client_id: this.config.clientId!,
        });
        const data = await requestJson(
            endpoint,
            {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded"},
                body,
            },
            this.timeout(),
            true,
        );
        if (
            !object(data) ||
            typeof data.access_token !== "string" ||
            !/^[\x21-\x7e]+$/.test(data.access_token) ||
            typeof data.token_type !== "string" ||
            data.token_type.toLowerCase() !== "bearer" ||
            typeof data.expires_in !== "number" ||
            !Number.isFinite(data.expires_in) ||
            data.expires_in <= 0 ||
            data.expires_in > 31536000 ||
            (data.refresh_token !== undefined &&
                (typeof data.refresh_token !== "string" ||
                    !/^[\x21-\x7e]+$/.test(data.refresh_token)))
        )
            throw new AppError("AUTH", "Invalid OAuth token response");
        const tokens: Tokens = {
            accessToken: data.access_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            context: this.context(),
            ...((data.refresh_token ?? previous?.refreshToken)
                ? {
                    refreshToken: (data.refresh_token ??
                        previous?.refreshToken) as string,
                }
                : {}),
        };
        await this.store.write(tokens);
        return tokens;
    }
}
