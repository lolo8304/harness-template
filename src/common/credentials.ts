import {lstat, mkdir, open, rename, unlink} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {homedir} from "node:os";
import {createHash, randomBytes} from "node:crypto";
import {AppError} from "./errors.js";
import {object} from "./http.js";

export interface Tokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    context: string;
}

export interface Store {
    read(): Promise<Tokens | undefined>;

    write(tokens: Tokens): Promise<void>;

    clear(): Promise<void>;
}

function valid(value: unknown): value is Tokens {
    return (
        object(value) &&
        typeof value.accessToken === "string" &&
        /^[\x21-\x7e]+$/.test(value.accessToken) &&
        typeof value.context === "string" &&
        typeof value.expiresAt === "number" &&
        Number.isFinite(value.expiresAt) &&
        (value.refreshToken === undefined ||
            (typeof value.refreshToken === "string" &&
                /^[\x21-\x7e]+$/.test(value.refreshToken)))
    );
}

function decode(raw: string, context: string) {
    let tokens: unknown;
    try {
        tokens = JSON.parse(raw);
    } catch {
        throw new AppError("AUTH", "Stored credentials are invalid; log in again");
    }
    if (!valid(tokens))
        throw new AppError("AUTH", "Stored credentials are invalid; log in again");
    return tokens.context === context ? tokens : undefined;
}

export function credentialContext(issuer = "", clientId = "") {
    return createHash("sha256")
        .update(JSON.stringify([issuer.replace(/\/$/, ""), clientId]))
        .digest("hex");
}

export class FileStore implements Store {
    private path: string;

    constructor(
        path: string,
        private context: string,
    ) {
        this.path = resolve(path);
    }

    async read() {
        try {
            return await this.readCredentials();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            if (error instanceof AppError) throw error;
            throw new AppError("AUTH", "Cannot read credential file securely");
        }
    }

    async write(tokens: Tokens) {
        if (!valid(tokens) || tokens.context !== this.context)
            throw new AppError("AUTH", "Invalid credentials");
        try {
            await this.writeCredentials(tokens);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError("AUTH", "Cannot save credentials securely");
        }
    }

    async clear() {
        try {
            await unlink(this.path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw new AppError("AUTH", "Cannot clear credential file");
        }
    }

    private async readCredentials() {
        let file;
        try {
            file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
            const info = await file.stat();
            if (
                !info.isFile() ||
                info.size > 65536 ||
                (process.platform !== "win32" &&
                    ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
            )
                throw new AppError("AUTH", "Credential file must be owner-only (0600)");
            return decode(await file.readFile("utf8"), this.context);
        } finally {
            await file?.close();
        }
    }

    private async writeCredentials(tokens: Tokens) {
        const dir = dirname(this.path);
        let temp: string | undefined;
        try {
            await mkdir(dir, {recursive: true, mode: 0o700});
            const info = await lstat(dir);
            if (
                !info.isDirectory() ||
                info.isSymbolicLink() ||
                (process.platform !== "win32" &&
                    ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
            )
                throw new AppError(
                    "AUTH",
                    "Credential directory must be owner-only (0700)",
                );
            temp = join(dir, `.credentials-${randomBytes(12).toString("hex")}`);
            const file = await open(temp, "wx", 0o600);
            try {
                await file.writeFile(JSON.stringify(tokens));
                await file.sync();
            } finally {
                await file.close();
            }
            await rename(temp, this.path);
            temp = undefined;
        } finally {
            if (temp) await unlink(temp).catch(() => {
            });
        }
    }
}

export class KeyringStore implements Store {
    constructor(private context: string) {
    }

    async read() {
        try {
            const raw = await (await this.entry()).getPassword();
            return raw === null ? undefined : decode(raw, this.context);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                "AUTH",
                "Cannot read OS credentials; unlock the store or explicitly use VEHICLE_CREDENTIAL_STORE=file",
            );
        }
    }

    async write(tokens: Tokens) {
        if (!valid(tokens) || tokens.context !== this.context)
            throw new AppError("AUTH", "Invalid credentials");
        try {
            await (await this.entry()).setPassword(JSON.stringify(tokens));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                "AUTH",
                "Cannot save OS credentials; unlock the store or explicitly use VEHICLE_CREDENTIAL_STORE=file",
            );
        }
    }

    async clear() {
        try {
            await (await this.entry()).deleteCredential();
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError("AUTH", "Cannot clear OS credentials");
        }
    }

    private async entry() {
        try {
            const moduleName = "@napi-rs/keyring";
            const {AsyncEntry} = await import(moduleName);
            return new AsyncEntry("harness-template", this.context, {
                linux: {store: "secret-service"},
            });
        } catch {
            throw new AppError(
                "AUTH",
                "OS credential store unavailable; explicitly set VEHICLE_CREDENTIAL_STORE=file to use owner-only storage",
            );
        }
    }
}

export function createStore(env: NodeJS.ProcessEnv): Store {
    const context = credentialContext(
        env.CLERK_OAUTH_ISSUER,
        env.CLERK_OAUTH_CLIENT_ID,
    );
    const kind = env.VEHICLE_CREDENTIAL_STORE ?? "keyring";
    if (kind === "file") {
        if (process.platform === "win32")
            throw new AppError(
                "AUTH",
                "File fallback requires POSIX owner-only permissions; use the OS credential store on Windows",
            );
        return new FileStore(
            env.VEHICLE_CREDENTIAL_FILE ??
            join(homedir(), ".config", "harness-template", "credentials.json"),
            context,
        );
    }
    if (kind === "keyring") return new KeyringStore(context);
    throw new AppError(
        "VALIDATION",
        "VEHICLE_CREDENTIAL_STORE must be keyring or file",
    );
}
