import {execWithClosedStdin} from "../common/subprocess.mjs";
import {verifyOpenCodeEvents} from "./opencode-evidence.mjs";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const exec = execWithClosedStdin;
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "vehicle-install-"));
const children = [];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function start(kind) {
    const child = spawn(
        process.execPath,
        [
            join(
                dir,
                "prefix",
                "lib",
                "node_modules",
                "harness-template",
                "dist",
                "mock.js",
            ),
            kind,
            "0",
        ],
        {stdio: ["ignore", "pipe", "pipe"]},
    );
    children.push(child);
    return new Promise((resolve, reject) => {
        let text = "";
        const timer = setTimeout(
            () => reject(new Error("Mock startup timed out")),
            5000,
        );
        child.once("error", reject);
        child.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`Mock exited: ${code}`));
        });
        child.stdout.on("data", (chunk) => {
            text += chunk;
            if (text.includes("\n")) {
                clearTimeout(timer);
                resolve(JSON.parse(text.split("\n")[0]).url);
            }
        });
    });
}

try {
    if (process.platform === "win32")
        throw new Error("Installation verifier currently requires a POSIX shell");
    const packed = await exec(
        npm,
        ["pack", "--json", "--pack-destination", dir],
        {cwd: root, maxBuffer: 2_000_000},
    );
    const packResult = JSON.parse(packed.stdout);
    const manifest = Array.isArray(packResult)
        ? packResult[0]
        : Object.values(packResult)[0];
    assert(manifest.files.some((f) => f.path === "dist/cli.js"));
    assert(
        !manifest.files.some((f) => f.path === ".env"),
        "Private .env must never be packaged",
    );
    assert(
        !manifest.files.some((f) => /^(cli|api|hooks|lib|tests)\//.test(f.path)),
    );
    await exec(
        npm,
        [
            "install",
            "--global",
            "--prefix",
            join(dir, "prefix"),
            "--no-audit",
            "--no-fund",
            join(dir, manifest.filename),
        ],
        {cwd: dir, maxBuffer: 2_000_000},
    );
    const catalog = await start("catalog");
    const insured = await start("insured");
    const env = {
        ...process.env,
        PATH: `${join(dir, "prefix", "bin")}:${process.env.PATH}`,
        VEHICLE_MOCK: "1",
        VEHICLE_CATALOG_URL: catalog,
        VEHICLE_INSURED_URL: insured,
        VEHICLE_CREDENTIAL_STORE: "file",
        VEHICLE_CREDENTIAL_FILE: join(dir, "credentials", "tokens.json"),
    };
    const command =
        "vehicle-cli combined search --customer-number C001 --brand tes --mode match --as-of 2025-06-01 --page 2 --limit 1";
    const result = await exec("/bin/sh", ["-c", command], {cwd: dir, env});
    assert.equal(result.stderr, "");
    const body = JSON.parse(result.stdout);
    assert.equal(body.total, 2);
    assert.equal(body.items[0].vehicle.vehicleId, "ve-002");
    assert.equal(body.items[0].vehicle.purchasePrice.amount, 47000);
    const status = await exec("/bin/sh", ["-c", "vehicle-cli auth status"], {
        cwd: dir,
        env,
    });
    assert.equal(JSON.parse(status.stdout).authenticated, false);
    let invalid;
    try {
        await exec("/bin/sh", ["-c", "vehicle-cli vehicles search --page 0"], {
            cwd: dir,
            env,
        });
    } catch (e) {
        invalid = e;
    }
    assert.equal(invalid?.code, 2);
    assert.equal(JSON.parse(invalid.stderr).error.code, "VALIDATION");
    const summary = {
        installation: "passed",
        shell: "passed",
        tarball: manifest.filename,
        packagedFiles: manifest.files.length,
        catalog: body.items[0].vehicle.vehicleId,
        opencode: "not requested",
    };
    if (process.argv.includes("--opencode")) {
        const project = dir;
        await exec("git", ["init", "--quiet"], {cwd: project});
        // Keep the installed CLI inside the test project and put only public mock
        // settings in its private temporary .env. No credentials are supplied.
        await writeFile(
            join(project, ".env"),
            `VEHICLE_MOCK=1\nVEHICLE_CATALOG_URL=${catalog}\nVEHICLE_INSURED_URL=${insured}\n`,
            {mode: 0o600},
        );
        const agentCommand =
            "node prefix/lib/node_modules/harness-template/dist/cli.js combined search --customer-number C001 --brand tes --mode match --as-of 2025-06-01 --page 2 --limit 1";
        const configPath = join(project, "opencode.json");
        await writeFile(
            configPath,
            JSON.stringify({
                $schema: "https://opencode.ai/config.json",
                permissions: [
                    {action: "*", resource: "*", effect: "deny"},
                    {action: "shell", resource: agentCommand, effect: "allow"},
                ],
            }),
        );
        let run;
        try {
            run = await exec(
                "opencode",
                [
                    "run",
                    ...(process.env.VEHICLE_OPENCODE_STANDALONE !== "0"
                        ? ["--standalone"]
                        : []),
                    "--print-logs",
                    ...(process.env.VEHICLE_OPENCODE_MODEL
                        ? ["--model", process.env.VEHICLE_OPENCODE_MODEL]
                        : []),
                    "--format",
                    "json",
                    "--title",
                    "Vehicle CLI mock smoke test",
                    `Use the shell tool with workdir set to ${JSON.stringify(project)} to execute exactly this command once (copy the whole line, without extra punctuation):\n${agentCommand}\nThis is a local read-only mock API smoke test. Do not edit or read files and do not run any other command. Report the returned vehicleId and total.`,
                ],
                {cwd: project, env, timeout: 120000, maxBuffer: 4_000_000},
            );
        } catch (error) {
            if (process.env.VEHICLE_OPENCODE_EVIDENCE)
                await writeFile(
                    resolve(process.env.VEHICLE_OPENCODE_EVIDENCE),
                    (error.stdout ?? "") + "\n" + (error.stderr ?? ""),
                );
            console.error(
                JSON.stringify({
                    ...summary,
                    opencode: "failed",
                    reason: error.killed ? "timed out" : "OpenCode process failed",
                }),
            );
            throw new Error(
                "OpenCode smoke test failed; inspect VEHICLE_OPENCODE_EVIDENCE when configured",
            );
        }
        // Keep the full tool evidence only when explicitly requested, outside the temporary prefix.
        if (process.env.VEHICLE_OPENCODE_EVIDENCE)
            await writeFile(
                resolve(process.env.VEHICLE_OPENCODE_EVIDENCE),
                run.stdout + "\n" + run.stderr,
            );
        verifyOpenCodeEvents(run.stdout, agentCommand);
        summary.opencode = "passed";
    }
    console.log(JSON.stringify(summary, null, 2));
} finally {
    await Promise.all(
        children.map(
            (child) =>
                new Promise((resolve) => {
                    if (child.exitCode !== null) return resolve();
                    child.once("exit", resolve);
                    child.kill("SIGTERM");
                }),
        ),
    );
    await rm(dir, {recursive: true, force: true});
}
