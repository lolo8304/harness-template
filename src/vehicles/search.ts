import {AppError} from "../common/errors.js";
import {dateValue, positiveInteger, today} from "../common/index.js";
import type {Kind, Search, Vehicle} from "./types.js";

export const catalogKeys = [
    "vehicleId",
    "vin",
    "registrationNumber",
    "brand",
    "model",
    "vehicleType",
    "modelYear",
    "firstRegistrationDate",
    "seats",
];
export const insuredKeys = [
    "plateNumber",
    "customerNumber",
    "policyNumber",
    "vehicleId",
];

export function parseSearch(
    input: Record<string, unknown>,
    kind: Kind,
): Search {
    const keys =
        kind === "insured"
            ? insuredKeys
            : kind === "vehicles"
                ? catalogKeys
                : [...new Set([...catalogKeys, ...insuredKeys])];
    const allowed = new Set([
        ...keys,
        "page",
        "limit",
        ...(kind === "insured" ? [] : ["mode", "asOfDate"]),
    ]);
    const out: Search = {page: 1, limit: 20};
    if (kind !== "insured")
        Object.assign(out, {mode: "exact", asOfDate: today()});
    for (const [key, value] of Object.entries(input)) {
        if (!allowed.has(key))
            throw new AppError("VALIDATION", `Unknown filter: ${key}`);
        if (typeof value !== "string" && typeof value !== "number")
            throw new AppError("VALIDATION", `Invalid value for ${key}`);
        const text = String(value);
        if (!text.trim() || text.length > 1024)
            throw new AppError("VALIDATION", `Invalid value for ${key}`);
        if (["page", "limit", "modelYear", "seats"].includes(key)) {
            out[key] = positiveInteger(
                text,
                key,
                key === "limit"
                    ? 1000
                    : key === "modelYear"
                        ? 9999
                        : key === "seats"
                            ? 1000
                            : Number.MAX_SAFE_INTEGER,
            );
        } else if (key === "mode") {
            if (!["exact", "match"].includes(text))
                throw new AppError("VALIDATION", "mode must be exact or match");
            out[key] = text;
        } else if (key === "asOfDate" || key === "firstRegistrationDate")
            out[key] = dateValue(text);
        else if (key === "registrationNumber") {
            if (!/^[A-Za-z0-9]{8}$/.test(text))
                throw new AppError(
                    "VALIDATION",
                    "registrationNumber must contain exactly eight alphanumeric characters",
                );
            out[key] = text;
        } else out[key] = key === "plateNumber" ? text.trim().toUpperCase() : text;
    }
    if (!Number.isSafeInteger(out.page * out.limit))
        throw new AppError("VALIDATION", "Pagination exceeds supported range");
    return out;
}

export function matchesVehicle(vehicle: Partial<Vehicle>, search: Search) {
    return catalogKeys.every((key) => {
        const value = search[key];
        if (value === undefined) return true;
        const actual = vehicle[key as keyof Vehicle];
        if (search.mode === "match" && ["brand", "model"].includes(key))
            return String(actual ?? "")
                .toLowerCase()
                .includes(String(value).toLowerCase());
        return actual === value;
    });
}
