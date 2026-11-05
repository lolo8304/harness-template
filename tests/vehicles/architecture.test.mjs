import {test} from "node:test";
import assert from "node:assert/strict";
import {readdir, readFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve} from "node:path";
import ts from "typescript";

test("common library has no imports of the vehicle domain", async () => {
    const root = resolve("src/common");

    async function check(dir) {
        for (const entry of await readdir(dir, {withFileTypes: true})) {
            const path = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                await check(path);
                continue;
            }
            if (!path.endsWith(".ts")) continue;
            const source = ts.createSourceFile(
                path,
                await readFile(path, "utf8"),
                ts.ScriptTarget.Latest,
                true,
            );

            function inspect(node) {
                const specifier =
                    ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
                        ? node.moduleSpecifier
                        : undefined;
                if (
                    specifier &&
                    ts.isStringLiteral(specifier) &&
                    specifier.text.startsWith(".")
                ) {
                    const target = relative(root, resolve(dirname(path), specifier.text));
                    assert(
                        !target.startsWith("..") && !isAbsolute(target),
                        `${path} imports outside common: ${specifier.text}`,
                    );
                }
                ts.forEachChild(node, inspect);
            }

            inspect(source);
        }
    }

    await check(root);
});

test("public common and vehicle libraries expose reusable APIs without starting commands", async () => {
    const common = await import("harness-template/common");
    const domain = await import("harness-template/vehicles");
    const original = await import("harness-template");
    const mocks = await import("harness-template/mock");
    for (const name of [
        "Auth",
        "FileStore",
        "KeyringStore",
        "AppError",
        "requestJson",
        "loadEnvironment",
        "safeUrl",
        "positiveInteger",
        "dateValue",
        "paginate",
    ])
        assert.equal(typeof common[name], "function", name);
    assert.equal(original.VehicleClient, domain.VehicleClient);
    assert.equal(original.AppError, common.AppError);
    assert.equal(typeof mocks.startMock, "function");
    assert.equal(typeof mocks.mockResponse, "function");
    assert.deepEqual(common.paginate(["a", "b", "c"], {page: 2, limit: 1}), {
        items: ["b"],
        total: 3,
        page: 2,
        limit: 1,
    });
});

test("error-handling check inspects nested source folders", async (t) => {
    const {mkdtemp, mkdir, writeFile, rm} = await import("node:fs/promises");
    const {tmpdir} = await import("node:os");
    const {join} = await import("node:path");
    const {execWithClosedStdin} = await import("../../scripts/common/subprocess.mjs");
    const fixture = await mkdtemp(join(tmpdir(), "vehicle-architecture-"));
    t.after(() => rm(fixture, {recursive: true, force: true}));
    await mkdir(join(fixture, "src", "nested"), {recursive: true});
    for (const dir of ["scripts", "bin"]) await mkdir(join(fixture, dir));
    await writeFile(
        join(fixture, "src", "nested", "bad.ts"),
        'try { throw new Error("caught locally"); } catch {}',
    );
    await assert.rejects(
        execWithClosedStdin(
            process.execPath,
            [resolve("scripts/common/check-error-handling.mjs")],
            {cwd: fixture},
        ),
        (error) => error.code === 1 && error.stderr.includes("src/nested/bad.ts"),
    );
});
