import {Command, CommanderError, Option} from "commander";
import {AppError, errorBody, exitCodes} from "../common/errors.js";
import {catalogKeys, insuredKeys, parseSearch} from "./search.js";
import type {Kind} from "./types.js";
import {apiConfig, checkConfiguration} from "./config.js";
import {authConfig} from "../common/config.js";
import {Auth} from "../common/auth.js";
import {createStore} from "../common/index.js";
import {VehicleClient} from "./client.js";
import {loadEnvironment} from "../common/env.js";

let envFile: ReturnType<typeof loadEnvironment>;

function output(value: unknown) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

function auth(noBrowser = false) {
    return new Auth(
        authConfig(process.env),
        createStore(process.env),
        noBrowser
            ? async (url) => {
                process.stderr.write(
                    `Open this authorization URL in your browser:\n${url}\n`,
                );
            }
            : undefined,
    );
}

function unique(value: string, previous: unknown) {
    if (previous !== undefined)
        throw new AppError("VALIDATION", "Duplicate option");
    return value;
}

const cli = new Command()
    .name("vehicle-cli")
    .description("Read-only catalog, insured and combined vehicle searches")
    .version("0.1.0")
    .option(
        "--env <path>",
        "Load a specific environment file (default: .env in current directory)",
        unique,
    )
    .hook("preAction", () => {
        envFile = loadEnvironment(cli.opts().env);
    })
    .exitOverride()
    .configureOutput({
        writeErr: () => {
        }
    });
cli.showHelpAfterError(false);
cli
    .command("config")
    .description("Inspect configuration without revealing values")
    .command("check")
    .description("Validate required settings; does not contact Clerk or APIs")
    .action(() => output({...checkConfiguration(process.env), envFile}));
const authCmd = cli.command("auth").description("Clerk OAuth authentication");
authCmd
    .command("login")
    .description("Sign in using browser OAuth + PKCE")
    .option(
        "--no-browser",
        "Print the authorization URL instead of opening a browser",
    )
    .action(async (opts) => output(await auth(opts.browser === false).login()));
authCmd
    .command("logout")
    .description("Revoke supported tokens and clear local credentials")
    .action(async () => output(await auth().logout()));
authCmd
    .command("status")
    .description("Show credential status without exposing tokens")
    .action(async () => output(await auth().status()));
for (const kind of ["vehicles", "insured", "combined"] as Kind[]) {
    const command = cli
        .command(kind)
        .description(`${kind} operations`)
        .command("search")
        .description(`Search ${kind} (all supplied filters are ANDed)`);
    const keys =
        kind === "insured"
            ? insuredKeys
            : kind === "vehicles"
                ? catalogKeys
                : [...new Set([...insuredKeys, ...catalogKeys])];
    for (const key of [
        ...keys,
        "page",
        "limit",
        ...(kind === "insured" ? [] : ["mode", "asOfDate"]),
    ]) {
        const flag =
            key === "asOfDate"
                ? "as-of"
                : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        const option = new Option(
            `--${flag} <value>`,
            key === "mode"
                ? "exact or match (brand/model substring matching only)"
                : `Filter/option: ${key}`,
        );
        option.argParser(unique);
        command.addOption(option);
    }
    command.action(async (opts) => {
        const {asOf, ...other} = opts;
        const filters = parseSearch(
            {...other, ...(asOf !== undefined ? {asOfDate: asOf} : {})},
            kind,
        );
        let getToken: () => Promise<string>;
        if (process.env.VEHICLE_MOCK === "1")
            getToken = async () => "local-mock-only";
        else {
            const session = auth();
            await session.token();
            getToken = () => session.token();
        }
        const client = new VehicleClient(apiConfig(process.env), getToken);
        output(await client.search(kind, filters));
    });
}

async function main() {
    if (process.argv.length < 3)
        throw new AppError(
            "VALIDATION",
            "Choose auth, vehicles, insured or combined; see --help",
        );
    await cli.parseAsync(process.argv);
}

await main().catch((error: unknown) => {
    if (error instanceof CommanderError && error.exitCode === 0)
        process.exitCode = 0;
    else {
        const safe =
            error instanceof CommanderError
                ? new AppError("VALIDATION", "Invalid command or option; see --help")
                : error;
        process.stderr.write(`${JSON.stringify(errorBody(safe))}\n`);
        process.exitCode = safe instanceof AppError ? exitCodes[safe.code] : 1;
    }
});
