# Template design and implementation plan

Approved scope: retain the runnable vehicle example and document adapting it to another domain.

Alternatives: a generic renamed domain requires redesigning a working API example; documentation alone cannot be built. Keep the working example, reusable common modules and verification tooling.

Constraints: Node.js 24+, no source-project changes, no copied secrets or credential files, no service startup during creation or verification. Use a separate npm identity and credential namespace; retain vehicle executable names as visible example names. No historical verification claims are inherited.

- [x] Copy maintained source, tests, scripts and configuration through an explicit allowlist.
- [x] Isolate package self-imports, lockfile identity and default credential storage.
- [x] Supply safe demo configuration and adaptation/build/OpenCode/run documentation.
- [x] Verify dependency installation, compilation, static checks, library imports, config/help and package contents without starting servers.

Full network/OAuth/OpenCode checks remain explicit operator steps. No global installation or login is performed by template creation.

Verification: npm ci --ignore-scripts, check:static (3/3 tests), CLI help, explicit example config check, Markdown links and npm package dry-run passed. No services started; no live OAuth/API/OpenCode check performed. Generated dependencies and dist exist locally after verification and are ignored.
