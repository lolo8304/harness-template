import {AppError} from "../common/errors.js";
import {positiveInteger} from "../common/index.js";
import {authConfig, isLoopback, safeUrl} from "../common/config.js";

export interface ApiConfig {
    catalogUrl: string;
    insuredUrl: string;
    timeoutMs: number;
}

export function apiConfig(env: NodeJS.ProcessEnv): ApiConfig {
    const urls = [env.VEHICLE_CATALOG_URL, env.VEHICLE_INSURED_URL];
    if (urls.some((u) => !u))
        throw new AppError(
            "VALIDATION",
            "Set VEHICLE_CATALOG_URL and VEHICLE_INSURED_URL",
        );
    const parsed = urls.map((u, i) =>
        safeUrl(u!, i === 0 ? "VEHICLE_CATALOG_URL" : "VEHICLE_INSURED_URL"),
    );
    if (parsed.some((u) => u.search))
        throw new AppError(
            "VALIDATION",
            "API base URLs must not contain query parameters",
        );
    if (env.VEHICLE_MOCK === "1" && parsed.some((u) => !isLoopback(u)))
        throw new AppError("VALIDATION", "Mock mode requires loopback API URLs");
    if (env.VEHICLE_MOCK && !["0", "1"].includes(env.VEHICLE_MOCK))
        throw new AppError("VALIDATION", "VEHICLE_MOCK must be 0 or 1");
    return {
        catalogUrl: parsed[0]!.href.replace(/\/$/, ""),
        insuredUrl: parsed[1]!.href.replace(/\/$/, ""),
        timeoutMs: positiveInteger(
            env.VEHICLE_TIMEOUT_MS ?? "10000",
            "VEHICLE_TIMEOUT_MS",
            300000,
        ),
    };
}

export function checkConfiguration(env: NodeJS.ProcessEnv) {
    const missing = [
        "VEHICLE_CATALOG_URL",
        "VEHICLE_INSURED_URL",
        ...(env.VEHICLE_MOCK === "1"
            ? []
            : ["CLERK_OAUTH_ISSUER", "CLERK_OAUTH_CLIENT_ID"]),
    ].filter((key) => !env[key]?.trim());
    if (missing.length)
        throw new AppError(
            "VALIDATION",
            `Missing configuration: ${missing.join(", ")}`,
        );
    apiConfig(env);
    const config = authConfig(env);
    if (config.issuer) safeUrl(config.issuer, "CLERK_OAUTH_ISSUER");
    if (config.issuer && new URL(config.issuer).search)
        throw new AppError(
            "VALIDATION",
            "OAuth issuer must not have query parameters",
        );
    if (
        env.VEHICLE_CREDENTIAL_STORE &&
        !["keyring", "file"].includes(env.VEHICLE_CREDENTIAL_STORE)
    )
        throw new AppError(
            "VALIDATION",
            "VEHICLE_CREDENTIAL_STORE must be keyring or file",
        );
    return {
        valid: true,
        mock: env.VEHICLE_MOCK === "1",
        clerk: {
            issuerConfigured: !!config.issuer?.trim(),
            clientIdConfigured: !!config.clientId?.trim(),
            scopesConfigured: !!config.scopes?.trim(),
            audienceConfigured: !!config.audience?.trim(),
            redirectUri:
                config.callbackPort === undefined
                    ? null
                    : `http://127.0.0.1:${config.callbackPort}/callback`,
        },
        apis: {catalogConfigured: true, insuredConfigured: true},
    };
}
