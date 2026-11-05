import {createServer} from "node:http";
import {AppError, errorBody} from "../common/errors.js";
import {paginate, positiveInteger} from "../common/index.js";
import {insuredKeys, matchesVehicle, parseSearch} from "./search.js";
import type {Vehicle} from "./types.js";
import {insured, vehicles} from "./fixtures.js";

export function mockResponse(
    kind: "catalog" | "insured",
    method: string | undefined,
    requestUrl: string | undefined,
): unknown {
    if (method !== "GET") {
        throw new AppError("API", "Only GET is supported", 405);
    }
    const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
    const base = kind === "catalog" ? "/vehicles" : "/insured-vehicles";
    const detail = kind === "catalog" && url.pathname.startsWith(`${base}/`);
    if (url.pathname !== base && !detail)
        throw new AppError("API", "Route not found", 404);
    const input: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
        if (key in input)
            throw new AppError("VALIDATION", `Duplicate filter: ${key}`);
        input[key] = value;
    }
    if (detail && Object.keys(input).some((k) => k !== "asOfDate"))
        throw new AppError("VALIDATION", "Vehicle detail accepts only asOfDate");
    const search = parseSearch(
        input,
        kind === "catalog" ? "vehicles" : "insured",
    );
    let result: unknown;
    if (kind === "catalog") {
        const project = (v: (typeof vehicles)[number]): Vehicle => {
            const price = [...v.prices]
                .reverse()
                .find((p) => p.effectiveDate <= search.asOfDate!);
            if (!price)
                throw new AppError(
                    "API",
                    "No purchase price available for requested date",
                    422,
                );
            const {prices: _prices, ...fields} = v;
            return {
                ...fields,
                purchasePrice: {
                    amount: price.amount,
                    currency: "CHF",
                    asOfDate: search.asOfDate!,
                },
            };
        };
        if (detail) {
            const id = decodeURIComponent(url.pathname.slice(base.length + 1));
            const v = vehicles.find((v) => v.vehicleId === id);
            if (!v) throw new AppError("API", "Vehicle not found", 404);
            result = project(v);
        } else
            result = paginate(
                vehicles.filter((v) => matchesVehicle(v, search)).map(project),
                search,
            );
    } else {
        result = paginate(
            insured.filter((i) =>
                insuredKeys.every(
                    (k) =>
                        search[k] === undefined || i[k as keyof typeof i] === search[k],
                ),
            ),
            search,
        );
    }
    return result;
}

export async function startMock(kind: "catalog" | "insured", port = 0) {
    const server = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "GET") res.setHeader("Allow", "GET");
        try {
            const result = mockResponse(kind, req.method, req.url);
            res.end(JSON.stringify(result));
        } catch (error) {
            res.statusCode =
                error instanceof AppError
                    ? (error.status ?? (error.code === "VALIDATION" ? 400 : 500))
                    : 500;
            res.end(JSON.stringify(errorBody(error)));
        }
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new AppError("INTERNAL", "Mock server did not bind");
    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}

async function main() {
    const [kind, rawPort] = process.argv.slice(2);
    if (!["catalog", "insured"].includes(kind ?? "") || process.argv.length > 4)
        throw new AppError(
            "VALIDATION",
            "Usage: vehicle-mock catalog|insured [port]",
        );
    const port =
        rawPort === undefined || rawPort === "0"
            ? 0
            : positiveInteger(rawPort, "port", 65535);
    const mock = await startMock(kind as "catalog" | "insured", port);
    process.stdout.write(
        `${JSON.stringify({kind, url: mock.url, localDevelopmentOnly: true})}\n`,
    );
    for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
            void mock.close().then(() => process.exit(0));
        });
}

export async function runMockCli() {
    await main().catch((error: unknown) => {
        process.stderr.write(`${JSON.stringify(errorBody(error))}\n`);
        process.exitCode =
            error instanceof AppError && error.code === "VALIDATION" ? 2 : 1;
    });
}
