import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const exec = promisify(execFile);

export function execWithClosedStdin(file, args, options) {
    // OpenCode run resolves its project from PWD before process.cwd(). Keep
    // both aligned so a temporary install cannot inherit the caller's rules.
    if (options?.cwd !== undefined) {
        const cwd = options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd;
        options = {
            ...options,
            env: {...(options.env ?? process.env), PWD: resolve(cwd)},
        };
    }
    const pending = exec(file, args, options);
    pending.child.stdin?.end();
    return pending;
}
