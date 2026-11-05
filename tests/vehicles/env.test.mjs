import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const exec = promisify(execFile);
const entry = resolve("dist/cli.js");
const contents =
    "CLERK_OAUTH_ISSUER=https://clerk.example.test\nCLERK_OAUTH_CLIENT_ID=private-test-client-value\nVEHICLE_CATALOG_URL=http://127.0.0.1:4010\nVEHICLE_INSURED_URL=http://127.0.0.1:4011\nVEHICLE_MOCK=0\nCLERK_OAUTH_CALLBACK_PORT=8765\n";

function cleanEnv() {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) => !key.startsWith("VEHICLE_") && !key.startsWith("CLERK_"),
        ),
    );
}

test("CLI loads cwd .env and verifies configuration without exposing values", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "vehicle-env-"));
    t.after(() => rm(dir, {recursive: true, force: true}));
    await writeFile(join(dir, ".env"), contents);
    const {stdout, stderr} = await exec(
        process.execPath,
        [entry, "config", "check"],
        {cwd: dir, env: cleanEnv()},
    );
    const result = JSON.parse(stdout);
    assert.equal(stderr, "");
    assert.equal(result.envFile.loaded, true);
    assert.equal(result.clerk.clientIdConfigured, true);
    assert.equal(result.clerk.redirectUri, "http://127.0.0.1:8765/callback");
    assert.equal(stdout.includes("private-test-client-value"), false);
    // Existing shell values must win over .env values.
    await assert.rejects(
        exec(process.execPath, [entry, "config", "check"], {
            cwd: dir,
            env: {...cleanEnv(), CLERK_OAUTH_ISSUER: "bad-url"},
        }),
        (e) => e.code === 2,
    );
});
test("explicit env path works from another directory; missing explicit file fails safely", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "vehicle-env-path-"));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const path = join(dir, "clerk.env");
    await writeFile(path, contents);
    const {stdout} = await exec(
        process.execPath,
        [entry, "--env", path, "config", "check"],
        {cwd: tmpdir(), env: cleanEnv()},
    );
    assert.equal(JSON.parse(stdout).envFile.loaded, true);
    await assert.rejects(
        exec(
            process.execPath,
            [entry, "--env", join(dir, "missing"), "config", "check"],
            {cwd: dir, env: cleanEnv()},
        ),
        (e) => e.code === 2 && !e.stderr.includes("private-test-client-value"),
    );
    await assert.rejects(
        exec(process.execPath, [entry, "config", "check"], {
            cwd: dir,
            env: cleanEnv(),
        }),
        (e) => e.code === 2 && e.stderr.includes("CLERK_OAUTH_ISSUER"),
    );
});

test("callback port configuration accepts 8765, supports unset, and rejects invalid ports", async () => {
    const {authConfig} = await import("../../dist/common/config.js");
    assert.equal(
        authConfig({CLERK_OAUTH_CALLBACK_PORT: "8765"}).callbackPort,
        8765,
    );
    assert.equal(authConfig({}).callbackPort, undefined);
    for (const value of ["0", "-1", "65536", "1.5", "abc", ""]) {
        assert.throws(
            () => authConfig({CLERK_OAUTH_CALLBACK_PORT: value}),
            (e) => e.code === "VALIDATION",
        );
    }
});
