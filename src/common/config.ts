import {AppError} from "./errors.js";
import {positiveInteger} from "./validation.js";

export function isLoopback(url: URL) {
    return ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
}

export function safeUrl(raw: string, name: string): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new AppError("VALIDATION", `${name} must be a valid URL`);
    }
    if (
        url.username ||
        url.password ||
        url.hash ||
        (url.protocol !== "https:" &&
            !(url.protocol === "http:" && isLoopback(url)))
    ) {
        throw new AppError(
            "VALIDATION",
            `${name} requires HTTPS (HTTP allowed only on loopback), without credentials or fragments`,
        );
    }
    return url;
}

export interface AuthConfig {
    issuer?: string;
    clientId?: string;
    scopes?: string;
    audience?: string;
    timeoutMs?: number;
    loginTimeoutMs?: number;
    callbackPort?: number;
}

export function authConfig(env: NodeJS.ProcessEnv): AuthConfig {
    return {
        issuer: env.CLERK_OAUTH_ISSUER,
        clientId: env.CLERK_OAUTH_CLIENT_ID,
        scopes: env.CLERK_OAUTH_SCOPES ?? "openid profile",
        audience: env.CLERK_OAUTH_AUDIENCE,
        callbackPort:
            env.CLERK_OAUTH_CALLBACK_PORT === undefined
                ? undefined
                : positiveInteger(
                    env.CLERK_OAUTH_CALLBACK_PORT,
                    "CLERK_OAUTH_CALLBACK_PORT",
                    65535,
                ),
        timeoutMs: positiveInteger(
            env.VEHICLE_TIMEOUT_MS ?? "10000",
            "VEHICLE_TIMEOUT_MS",
            300000,
        ),
        loginTimeoutMs: positiveInteger(
            env.VEHICLE_LOGIN_TIMEOUT_MS ?? "180000",
            "VEHICLE_LOGIN_TIMEOUT_MS",
            600000,
        ),
    };
}
