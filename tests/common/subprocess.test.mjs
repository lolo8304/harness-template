import {test} from "node:test";
import assert from "node:assert/strict";
import {execWithClosedStdin} from "../../scripts/common/subprocess.mjs";

test("noninteractive verification closes stdin so children waiting for EOF can start", async () => {
    const result = await execWithClosedStdin(
        process.execPath,
        [
            "-e",
            "process.stdin.resume();process.stdin.on('end',()=>console.log('received EOF'))",
        ],
        {timeout: 1000},
    );
    assert.equal(result.stdout.trim(), "received EOF");
});

test("subprocess clients honoring PWD load the requested project's permissions", async (t) => {
    const {mkdtemp, writeFile, rm} = await import("node:fs/promises");
    const {tmpdir} = await import("node:os");
    const {join} = await import("node:path");
    const project = await mkdtemp(join(tmpdir(), "harness-permissions-test-"));
    t.after(() => rm(project, {recursive: true, force: true}));
    await writeFile(join(project, "opencode.json"), JSON.stringify({
        permissions: [{action: "shell", resource: "isolated-command", effect: "allow"}],
    }));
    const script = `
        process.chdir(process.env.PWD ?? process.cwd());
        const {readFileSync} = require('node:fs');
        console.log(JSON.stringify(JSON.parse(readFileSync('opencode.json', 'utf8'))));
        console.log(process.env.HARNESS_TEST_MARKER);
    `;
    for (const env of [undefined, {...process.env, PWD: process.cwd(), HARNESS_TEST_MARKER: "preserved"}]) {
        const result = await execWithClosedStdin(process.execPath, ["-e", script], {
            cwd: project, env, timeout: 1000,
        });
        const [config, marker] = result.stdout.trim().split("\n");
        assert.deepEqual(JSON.parse(config).permissions, [
            {action: "shell", resource: "isolated-command", effect: "allow"},
        ]);
        if (env) assert.equal(marker, "preserved");
    }
});
