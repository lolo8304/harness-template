import {AppError} from "./errors.js";

export function today() {
    return new Date().toISOString().slice(0, 10);
}

export function dateValue(value: string): string {
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
    ) {
        throw new AppError(
            "VALIDATION",
            "Dates must be valid YYYY-MM-DD calendar dates",
        );
    }
    return value;
}

export function positiveInteger(
    value: string,
    name: string,
    max = Number.MAX_SAFE_INTEGER,
) {
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1 || n > max)
        throw new AppError(
            "VALIDATION",
            `${name} must be an integer between 1 and ${max}`,
        );
    return n;
}
