import { rm, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
const result = spawnSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
for (const entry of ["cli.js", "mock.js"])
  await chmod(new URL(`../dist/${entry}`, import.meta.url), 0o755);
