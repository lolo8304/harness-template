import ts from "typescript";
import {readdirSync, readFileSync} from "node:fs";

const warnings = [];

function* sourceFiles(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) yield* sourceFiles(path);
        else if (entry.isFile() && /\.(ts|mjs)$/.test(entry.name)) yield path;
    }
}

for (const directory of ["src", "scripts", "bin"]) {
    for (const path of sourceFiles(directory)) {
        const source = ts.createSourceFile(
            path,
            readFileSync(path, "utf8"),
            ts.ScriptTarget.Latest,
            true,
        );

        function inspect(node) {
            if (ts.isTryStatement(node) && node.catchClause) {
                function inspectThrows(child) {
                    // A callee throwing into its caller's boundary handler is intentional.
                    if (ts.isFunctionLike(child)) return;
                    if (ts.isThrowStatement(child)) {
                        const {line, character} = source.getLineAndCharacterOfPosition(
                            child.getStart(source),
                        );
                        warnings.push(
                            `${path}:${line + 1}:${character + 1}: explicit throw caught in the same function`,
                        );
                    }
                    ts.forEachChild(child, inspectThrows);
                }

                inspectThrows(node.tryBlock);
            }
            ts.forEachChild(node, inspect);
        }

        inspect(source);
    }
}
if (warnings.length) {
    console.error([...new Set(warnings)].join("\n"));
    process.exitCode = 1;
} else
    console.log("Error-handling check passed: no explicit throws caught locally");
