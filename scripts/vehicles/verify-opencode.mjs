import {execWithClosedStdin} from "../common/subprocess.mjs";
import {writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {loadEnvironment} from "../../dist/common/env.js";
import {apiConfig} from "../../dist/vehicles/config.js";
import {isLoopback} from "../../dist/common/config.js";
import {verifyOpenCodeEvents} from "./opencode-evidence.mjs";

const exec = execWithClosedStdin;
const launcherEnv = {...process.env};
const root = fileURLToPath(new URL("../../", import.meta.url));
const checks = [
    {
        name: "catalog",
        command:
            "node dist/cli.js vehicles search --brand Tesla --as-of 2025-06-01",
        expected: {
            total: 2,
            page: 1,
            limit: 20,
            vehicleIds: ["ve-001", "ve-002"],
        },
    },
    {
        name: "insured",
        command: 'node dist/cli.js insured search --plate-number "ZH 638871"',
        expected: {total: 1, page: 1, limit: 20, vehicleIds: ["ve-001"]},
    },
    {
        name: "combined",
        command:
            "node dist/cli.js combined search --customer-number C001 --brand tes --mode match --as-of 2025-06-01 --page 2 --limit 1",
        expected: {total: 2, page: 2, limit: 1, vehicleIds: ["ve-002"]},
    },
];

async function verify() {
    loadEnvironment(resolve(root, ".env"));
    const config = apiConfig(process.env);
    if (
        ![config.catalogUrl, config.insuredUrl].every((url) =>
            isLoopback(new URL(url)),
        )
    )
        throw new Error("This fixture verifier requires loopback mock API URLs");
    // Fail promptly if the local APIs/login are unavailable, before invoking an agent.
    const preflight = await exec(
        process.execPath,
        [
            "dist/cli.js",
            "combined",
            "search",
            "--customer-number",
            "C001",
            "--brand",
            "Tesla",
        ],
        {cwd: root, timeout: 15000},
    );
    if (JSON.parse(preflight.stdout).total !== 2)
        throw new Error("Local mock fixtures did not match expected data");
    const prompt =
        "Use the shell tool to run each command below separately and exactly as written, in order. Do not read or edit any files or run other commands. Report each JSON total and vehicleId.\n\n" +
        checks.map((x) => x.command).join("\n\n");
    let result;
    try {
        result = await exec(
            "opencode",
            [
                "run",
                "--format",
                "json",
                ...(process.env.VEHICLE_OPENCODE_MODEL
                    ? ["--model", process.env.VEHICLE_OPENCODE_MODEL]
                    : []),
                "--title",
                "Vehicle shell integration verification",
                prompt,
            ],
            {cwd: root, env: launcherEnv, timeout: 120000, maxBuffer: 4_000_000},
        );
    } catch (error) {
        if (process.env.VEHICLE_OPENCODE_EVIDENCE)
            await writeFile(
                resolve(process.env.VEHICLE_OPENCODE_EVIDENCE),
                (error.stdout ?? "") + "\n" + (error.stderr ?? ""),
            );
        throw new Error(
            error.killed
                ? "OpenCode run timed out"
                : "OpenCode run failed; inspect optional event evidence",
        );
    }
    if (process.env.VEHICLE_OPENCODE_EVIDENCE)
        await writeFile(
            resolve(process.env.VEHICLE_OPENCODE_EVIDENCE),
            result.stdout,
        );
    for (const check of checks)
        verifyOpenCodeEvents(result.stdout, check.command, check.expected);
    console.log(
        JSON.stringify(
            {
                opencode: "passed",
                checks: checks.map(({name, expected}) => ({
                    search: name,
                    exit: 0,
                    ...expected,
                })),
            },
            null,
            2,
        ),
    );
}

await verify().catch((error) => {
    // Do not dump execFile errors, which embed full environment-dependent command output.
    console.error(
        JSON.stringify({
            opencode: "failed",
            message: error.cmd
                ? "Preflight failed; check local mock servers and vehicle-cli auth status"
                : error.message,
        }),
    );
    process.exitCode = 1;
});
