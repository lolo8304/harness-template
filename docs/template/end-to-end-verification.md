# End-to-end verification — 2026-11-06

The template was tested independently of the source vehicle harness, using Node.js 24.22.0, npm 12.2.0 and OpenCode 2.2.5 with `opencode/big-pickle`.

## Passed

- `npm test`: 33 tests passed, zero failures. Includes mock HTTP routes, CLI errors, joins across upstream pages, lookup failures, OAuth test-server lifecycle, secure credential storage and event-evidence validation.
- Project CLI: catalog, insured and paginated combined queries returned the expected totals against newly started template mocks.
- Real OpenCode agent: `opencode run --standalone --model opencode/big-pickle --format json` from this template root executed exactly three shell calls using the template project configuration. Each completed with exit 0 and valid JSON matching expected IDs and pagination; no other tools were called.
- Separate package check: `npm run verify:install` packs and installs under a temporary prefix, starts its own ephemeral mock APIs, verifies the installed CLI through a POSIX shell, checks unauthenticated status and invalid-filter exit behavior, then removes its temporary installation and services.

| Agent search | Expected and observed |
| --- | --- |
| Catalog / Tesla | total 2, page 1, IDs `ve-001`, `ve-002` |
| Insured / ZH 638871 | total 1, page 1, ID `ve-001` |
| Combined / C001, brand match tes | total 2, page 2, limit 1, ID `ve-002` |

## Isolation and cleanup

The project E2E orchestrator called the template's `startMock(kind, 0)` API. Port zero lets the OS allocate unused ports; this run used catalog **53062** and insured **53063**, both on `127.0.0.1`. The selected URLs and `VEHICLE_MOCK=1` were passed only in child-process environments. No private `.env`, production credentials or global executable installation was needed. The mock APIs were closed in `finally`, and socket probes confirmed both ports stopped accepting connections afterward.

OpenCode's `--standalone` mode launched its own private server with port zero; it did not attach to or restart the existing background OpenCode service. The CLI logs from the diagnostic packed run confirm private server shutdown on exit. No original vehicle harness processes were stopped or restarted, no original configuration was changed, and ports 4010/4011 were not used for these checks. Existing listeners were not visible in this execution environment, so no claim is made about their external health.

## Packed-agent permission fix and rerun

The original packed-agent permission failure was caused by an inherited `PWD` pointing to the template root. OpenCode 2.2.5's `run` implementation selects `process.env.PWD` before `process.cwd()`, even when the caller supplies a different subprocess `cwd`.

The shared verification subprocess helper now sets the child `PWD` to the requested working directory, while preserving its explicit environment and closing stdin as before. No allow/deny rules were broadened, and no `--auto` option was added. A regression test reproduces a PWD-aware client reading the wrong project's permissions before the fix and the isolated project's permissions after it, with inherited and explicit environments. The full suite now passes **34/34** tests.

The packed-install OpenCode verifier was rerun with `VEHICLE_OPENCODE_STANDALONE=1` and model `opencode/deepseek-v4.1-flash-free`, because the original `opencode/big-pickle` model had also returned a free-usage limit. Packaging, temporary installation, installed shell searches, auth-status isolation and validation checks passed. Private-server logs now show the temporary installed project (`vehicle-install-ppCd1b`) as the initialized location, rather than the template root.

The provider then returned `provider.free-limit`, HTTP **429**, before an agent tool call. Therefore the corrected directory selection and regression test are verified, but **a successful live packed-agent shell event remains unverified**. The verifier correctly returned nonzero. Its private OpenCode server shut down and its temporary installation/mock processes were removed in cleanup. No running source vehicle harness service or configuration was changed.

Retry when model quota is available, from this template root:

```sh
VEHICLE_OPENCODE_STANDALONE=1 VEHICLE_OPENCODE_MODEL=opencode/big-pickle npm run verify:install -- --opencode
```

Ensure `opencode` is on `PATH` first (on this machine it is installed under `~/.opencode/bin`). No authentication changes or paid provider setup were performed.

## Evidence

- [Project run summary](verification/project-summary.json)
- [Project completed tool events](verification/project-opencode-events.jsonl)
- [Original failed packed-agent diagnostic events](verification/packed-opencode-events.jsonl)
- [Corrected packed-agent rerun events](verification/packed-opencode-fixed-events.jsonl)
- [Corrected packed-agent rerun summary](verification/packed-opencode-fixed-summary.json)

The JSONL files are local review artifacts with owner-only permissions. A successful mock run does not establish compatibility with real OAuth providers or production resource APIs.
