import {AppError} from "./errors.js";

/** Translate transport failures without exposing URLs, headers or native messages. */
async function transport<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("NETWORK", "Request failed or timed out");
    }
}

async function responseText(
    response: Response,
    code: "AUTH" | "API",
): Promise<string> {
    const reader = await transport(() => response.body?.getReader());
    if (!reader) throw new AppError(code, "Empty response");

    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const {done, value} = await transport(() => reader.read());
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
            await transport(() => reader.cancel());
            throw new AppError(code, "Response exceeds size limit");
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}

function parseResponse(text: string, code: "AUTH" | "API"): unknown {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new AppError(code, "Response is not valid JSON");
    }
}

/** Never propagate response text, request URLs, headers, tokens or native exception messages. */
export async function requestJson(
    url: URL | string,
    init: RequestInit,
    timeoutMs: number,
    auth = false,
): Promise<unknown> {
    const response = await transport(() =>
        fetch(url, {
            ...init,
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
        }),
    );
    if (!response.ok) {
        await transport(() => response.body?.cancel());
        throw new AppError(
            auth || [401, 403].includes(response.status) ? "AUTH" : "API",
            auth ? "OAuth request rejected" : "API request failed",
            response.status,
        );
    }

    const code = auth ? "AUTH" : "API";
    return parseResponse(await responseText(response, code), code);
}

export function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
