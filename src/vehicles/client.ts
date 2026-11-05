import {AppError, errorBody} from "../common/errors.js";
import {dateValue, type Page, paginate} from "../common/index.js";
import {safeUrl} from "../common/config.js";
import {object, requestJson} from "../common/http.js";
import {insuredKeys, matchesVehicle, parseSearch} from "./search.js";
import type {ApiConfig} from "./config.js";
import type {Insured, Joined, Kind, Search, Vehicle} from "./types.js";

export {AppError} from "../common/errors.js";
export type {Vehicle, Insured, Joined, Kind} from "./types.js";
export type {Page} from "../common/pagination.js";

function isVehicle(value: unknown): value is Vehicle {
    if (
        !object(value) ||
        ![
            "vehicleId",
            "vin",
            "registrationNumber",
            "brand",
            "model",
            "vehicleType",
            "firstRegistrationDate",
        ].every((k) => typeof value[k] === "string" && value[k] !== "")
    )
        return false;
    if (
        !/^[A-Za-z0-9]{8}$/.test(value.registrationNumber as string) ||
        !Number.isInteger(value.modelYear) ||
        !Number.isInteger(value.seats) ||
        Number(value.modelYear) < 1 ||
        Number(value.seats) < 1
    )
        return false;
    try {
        dateValue(value.firstRegistrationDate as string);
    } catch {
        return false;
    }
    const p = value.purchasePrice;
    if (
        !object(p) ||
        typeof p.amount !== "number" ||
        !Number.isFinite(p.amount) ||
        p.amount < 0 ||
        p.currency !== "CHF" ||
        typeof p.asOfDate !== "string"
    )
        return false;
    try {
        dateValue(p.asOfDate);
    } catch {
        return false;
    }
    return true;
}

function isInsured(value: unknown): value is Insured {
    return (
        object(value) &&
        ["id", ...insuredKeys].every(
            (k) => typeof value[k] === "string" && value[k] !== "",
        )
    );
}

export class VehicleClient {
    constructor(
        private config: ApiConfig,
        private getToken: () => Promise<string>,
    ) {
        for (const url of [config.catalogUrl, config.insuredUrl])
            safeUrl(url, "API base URL");
        if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)
            throw new AppError("VALIDATION", "Invalid request timeout");
    }

    async search(
        kind: Kind,
        input: Record<string, unknown>,
    ): Promise<Page<Vehicle | Insured | Joined>> {
        const search = parseSearch(input, kind);
        if (kind !== "combined") return this.page(kind, search);
        const insuredSearch = parseSearch(
            Object.fromEntries(
                insuredKeys
                    .filter((k) => search[k] !== undefined)
                    .map((k) => [k, search[k]]),
            ),
            "insured",
        );
        insuredSearch.limit = 1000;
        const joined: Joined[] = [];
        const cache = new Map<string, Vehicle | ReturnType<typeof errorBody>>();
        for (let page = 1; ; page++) {
            const batch = await this.page<Insured>("insured", {
                ...insuredSearch,
                page,
            });
            for (const record of batch.items) {
                let lookup = cache.get(record.vehicleId);
                if (!lookup) {
                    try {
                        lookup = await this.vehicle(record.vehicleId, search.asOfDate!);
                    } catch (error) {
                        if (error instanceof AppError && error.code === "AUTH") throw error;
                        lookup = errorBody(error);
                    }
                    cache.set(record.vehicleId, lookup);
                }
                if ("error" in lookup)
                    joined.push({insured: record, vehicleLookupError: lookup.error});
                else if (matchesVehicle(lookup, search))
                    joined.push({insured: record, vehicle: lookup});
            }
            if (page * insuredSearch.limit >= batch.total) break;
            if (!batch.items.length || page >= 10000)
                throw new AppError("API", "Insured pagination did not complete");
        }
        return paginate(joined, search);
    }

    private async get(
        base: string,
        path: string,
        query: Record<string, string | number>,
    ) {
        const url = new URL(`${base.replace(/\/$/, "")}${path}`);
        for (const [key, value] of Object.entries(query))
            url.searchParams.set(key, String(value));
        const token = await this.getToken();
        if (!/^[\x21-\x7e]+$/.test(token))
            throw new AppError("AUTH", "Invalid access token");
        return requestJson(
            url,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
            },
            this.config.timeoutMs,
        );
    }

    private async page<T extends Vehicle | Insured>(
        kind: "vehicles" | "insured",
        search: Search,
    ): Promise<Page<T>> {
        const data = await this.get(
            kind === "vehicles" ? this.config.catalogUrl : this.config.insuredUrl,
            kind === "vehicles" ? "/vehicles" : "/insured-vehicles",
            search,
        );
        const check = kind === "vehicles" ? isVehicle : isInsured;
        if (
            !object(data) ||
            !Array.isArray(data.items) ||
            !data.items.every(check) ||
            !Number.isSafeInteger(data.total) ||
            Number(data.total) < 0 ||
            data.page !== search.page ||
            data.limit !== search.limit ||
            data.items.length > search.limit ||
            data.items.length > Number(data.total)
        )
            throw new AppError("API", "Invalid API page response");
        if (
            kind === "vehicles" &&
            data.items.some(
                (item) => (item as Vehicle).purchasePrice.asOfDate !== search.asOfDate,
            )
        )
            throw new AppError(
                "API",
                "Catalog returned a price for a different date",
            );
        return data as unknown as Page<T>;
    }

    private async vehicle(vehicleId: string, asOfDate: string): Promise<Vehicle> {
        const data = await this.get(
            this.config.catalogUrl,
            `/vehicles/${encodeURIComponent(vehicleId)}`,
            {asOfDate},
        );
        if (
            !isVehicle(data) ||
            data.vehicleId !== vehicleId ||
            data.purchasePrice.asOfDate !== asOfDate
        )
            throw new AppError("API", "Invalid vehicle detail response");
        return data;
    }
}
