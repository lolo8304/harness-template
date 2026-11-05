import {readFileSync} from "node:fs";
import {parseEnv} from "node:util";
import {resolve} from "node:path";
import {AppError} from "./errors.js";

export function loadEnvironment(explicitPath?: string) {
    const path = resolve(explicitPath ?? ".env");
    try {
        const parsed = parseEnv(readFileSync(path, "utf8"));
        for (const [key, value] of Object.entries(parsed))
            if (process.env[key] === undefined) process.env[key] = value;
        return {path, loaded: true};
    } catch (error) {
        if (!explicitPath && (error as NodeJS.ErrnoException).code === "ENOENT")
            return {path, loaded: false};
        throw new AppError(
            "VALIDATION",
            "Cannot read environment file; check its path and permissions",
        );
    }
}
