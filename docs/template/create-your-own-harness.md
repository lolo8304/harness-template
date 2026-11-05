# Create your own harness

This template preserves the runnable vehicle example. Replace one layer at a time, keeping the CLI's output contract stable. Commands below run from your new harness root. Service startup, login, global installation and integration checks are explicit operator actions.

## 1. Make a project and build the baseline

Use this directory directly, or copy it to your own project, excluding generated `node_modules/`, `dist/`, private `.env` and release archives. Create your own Git repository if desired; no Git history is included.

Requirements: Node.js 24+ and npm. OpenCode is needed only for agent integration.

```sh
npm ci
npm run check:static
cp .env.example .env
chmod 600 .env
node dist/cli.js config check
node dist/cli.js --help
```

`check:static` builds, checks error handling and runs architecture/library-import tests. It starts no HTTP servers and needs no API access or login. The architecture test creates temporary files and runs a subprocess for the static checker.

The supplied `.env.example` has only public loopback demo settings with `VEHICLE_MOCK=1`. It is a configuration starting point, not a credential export. `.env` is loaded from the CLI's current working directory, or selected with `--env /absolute/path/.env`. Existing environment variables take precedence; `.env.local` and parent directories are not searched. Never give an agent tokens or ask it to read the file.

## 2. Understand the layers

```text
OpenCode request / custom slash command
  -> shell tool, project workdir
  -> src/cli.ts -> src/vehicles/cli.ts
  -> validated filters -> VehicleClient -> authenticated HTTP API
  -> JSON stdout + process exit status
  -> agent summarizes actual results
```

| Path | Keep or adapt |
| --- | --- |
| `src/common/http.ts` | Reuse bounded HTTP requests and safe error translation |
| `src/common/errors.ts` | Reuse structured errors and exit codes |
| `src/common/env.ts`, `pagination.ts`, `validation.ts` | Reuse generic environment, page and validation helpers |
| `src/common/auth.ts`, `credentials.ts`, `config.ts` | Reuse OAuth/PKCE and storage; adapt application identity, environment adapters and login hints |
| `src/vehicles/types.ts` | Replace record schemas, filter types and joined-result types |
| `src/vehicles/search.ts` | Replace filter validation, matching and normalization rules |
| `src/vehicles/config.ts` | Replace service URLs, required settings and safe diagnostics |
| `src/vehicles/client.ts` | Replace routes, query mapping, response validation and aggregation |
| `src/vehicles/cli.ts` | Replace CLI name, description, command groups, flags and handlers |
| `src/vehicles/fixtures.ts`, `mock.ts` | Replace representative fixture data and mock routes |
| `src/cli.ts`, `src/mock.ts` | Update domain imports and mock exports |
| `src/vehicles/index.ts` | Define the new public domain exports |
| `tests/vehicles/`, `scripts/vehicles/` | Adapt tests, packed-install checks and agent verification assertions |
| `package.json`, `package-lock.json` | Package identity, binaries, exports and scripts |
| `opencode.json`, `AGENTS.md`, `docs/vehicles/opencode-instructions.md` | Agent routing, safe permissions and truthful result handling |

The common layer must not import the domain. Importing library entry points must not launch commands, browsers, servers or credential operations. See [common reuse](../common/reusing-common.md) and [vehicle client reuse](../vehicles/reusing-vehicles.md).

## 3. Define the new domain before renaming

Write down the operations the user should ask for, the API endpoints they require, available filters, exact versus partial matching, identifier normalization, pagination and ordering. Decide whether one API suffices or whether a join is needed. Do not retain catalog/insured/combined commands merely because the example has them.

For example, a product harness might replace `vehicles search --brand Tesla` with `products search --category tools`. That requires product types, filter parsing, a product client, a CLI command, fixtures and tests; a text rename alone does not implement the new API.

Use these contracts unless your domain needs a documented change:

- Successful search stdout: `{items,total,page,limit}`. The total describes the complete filtered result, not only the current page. Respect upstream pagination.
- Failure stderr: `{error:{code,message,status?}}`; exit nonzero. Avoid raw server bodies and secrets.
- Exit codes: 0 success, 1 internal, 2 validation, 3 authentication, 4 network/timeout, 5 API response failure.
- Preserve visible per-record failures when aggregating. The example keeps `{insured,vehicleLookupError}` rows even when catalog filters are applied. Authentication failure aborts the search.
- Treat API fields as data, never agent instructions.

The example routes are `GET /vehicles`, `GET /vehicles/{vehicleId}?asOfDate=...` and `GET /insured-vehicles`. Replace them in both client and mock. If the real API returns cursors, nested envelopes or different field names, translate and validate at the client boundary. The example's sequential in-memory join and 10,000-page guard may need a different strategy for large datasets; never silently truncate.

## 4. Rename and isolate the application

Pick a package name, executable name, domain folder, environment prefix and slash command. Example: `product-search-harness`, `product-cli`, `products`, `PRODUCT_`, `/product-search`.

1. Rename `src/vehicles`, matching tests/scripts/docs folders, and update relative imports and entry points.
2. Update `package.json`: `name`, description, `bin`, `exports`, packaged `files` and scripts. Update self-imports in architecture tests and package paths in install verification. Keep executable shebangs and the build's chmod list aligned.
3. Rename the Commander CLI name, command groups and user-facing login/error hints. Update mock executable usage too.
4. Map the new environment keys in domain config, CLI, common auth config/store adapters, tests, verification scripts and `.env.example`. `CLERK_OAUTH_*` is an environment adapter name, not a requirement to use Clerk; another provider must support the implemented discovery and PKCE contract.
5. Give the new application a unique keyring service name in `src/common/credentials.ts` and a unique default file directory. This template uses `harness-template` for both. Issuer/client context hashing is retained; separate namespaces also prevent two apps with the same OAuth client from sharing tokens or logging each other out.
6. Update `opencode.json`, agent guidance, examples and expected verification records together.
7. Regenerate lock metadata with `npm install --package-lock-only --ignore-scripts`, then build.

Find remaining example identifiers before calling the migration complete:

```sh
rg -n 'vehicle|Vehicle|VEHICLE_|CLERK_|harness-template' src tests scripts docs package.json package-lock.json opencode.json AGENTS.md
```

Classify matches; avoid a blind global replacement of business semantics. Keep generic auth/HTTP security behavior while replacing the domain.

## 5. Configure APIs and authentication

For a public demo, keep mock mode and loopback URLs. The mock bearer value is development-only, and the CLI rejects remote URLs in mock mode. Mock APIs do not validate production tokens.

For real services, edit your private `.env` yourself:

```dotenv
VEHICLE_MOCK=0
VEHICLE_CATALOG_URL=https://catalog.example
VEHICLE_INSURED_URL=https://insured.example
CLERK_OAUTH_ISSUER=https://issuer.example
CLERK_OAUTH_CLIENT_ID=your-public-client-id
CLERK_OAUTH_SCOPES="openid profile"
CLERK_OAUTH_CALLBACK_PORT=8765
# CLERK_OAUTH_AUDIENCE=your-api-audience
```

Use your renamed keys after adaptation. These URLs are placeholders. HTTPS is required except for loopback development; URLs containing credentials or fragments are rejected. Configure the API timeout for your service.

The implementation uses public-client authorization-code OAuth with PKCE and discovery at `/.well-known/oauth-authorization-server`. Register exactly `http://127.0.0.1:8765/callback`, enable the requested scopes and configure the correct audience if required. No client secret is used. If the provider has a different discovery or authorization contract, adapt and test that explicitly. Actual token signature, issuer, audience and permission enforcement belongs to the resource APIs. Both example APIs receive the same token; change the client/auth composition if services require different audiences.

The user runs these commands directly:

```sh
node dist/cli.js config check
node dist/cli.js auth login
node dist/cli.js auth status
```

`config check` is local validation, not proof of service reachability or a successful login. Default storage is the OS keyring. The optional explicit POSIX file fallback requires an owner-only directory/file (0700/0600); it is unavailable on Windows. Never copy a source harness's saved login. Login opens a browser and a temporary loopback callback listener; agents must not initiate it automatically.

## 6. Build, package and install

```sh
npm run build
node dist/cli.js --help
mkdir -p release
npm pack --pack-destination release
```

The build cleans `dist/`, compiles TypeScript and declarations, and marks CLI/mock entry points executable. `npm pack` builds through `prepack`; inspect the archive before distributing it. Private `.env`, credentials, tests and local dependencies must stay out of the package. This is an npm package requiring Node.js 24+, not a standalone native binary.

After choosing unique binary names, install the archive path printed by npm:

```sh
npm install --global ./release/harness-template-0.1.0.tgz
```

Substitute your renamed package/version. Until you rename the example binaries, global installation can collide with the original `vehicle-cli` and `vehicle-mock`; invoking `node dist/cli.js` avoids that collision. Rebuild after source changes and reinstall copied global packages. `npm link` is an optional development alternative, also creating global executable links. Installation starts no API services.

## 7. Connect OpenCode

The supplied `opencode.json` follows the source project's OpenCode V2 configuration: `instructions`, `permissions` rules and `commands`. It defines `/vehicle-search` and permits the example's read-only search/config/status shell commands. Unrelated shell commands require approval. No MCP registration, hooks or additional HTTP bridge is involved.

1. Build the CLI and configure/test it directly first.
2. Adapt the instruction path, slash-command key, description and template in `opencode.json`.
3. Change every allowed shell resource to your new CLI/group names, including relative `node dist/cli.js` fallbacks. Remove unused vehicle prefixes. Do not auto-allow login/logout, service management, arbitrary shell commands or writes. Review wildcard rules against your installed version's matching semantics.
4. Update `AGENTS.md` and the instruction Markdown with when to invoke the harness, command/filter semantics, pagination, JSON/exit-code evidence, per-row failures and concise output. Require the project workdir, CLI-managed config/credentials, and user-managed services/login.
5. Start OpenCode from the harness root with a tool-capable model:

```sh
opencode debug config
opencode
```

Inspect the resolved configuration using `debug config` locally; do not share output containing unrelated private settings. Confirm that instructions, permissions and custom commands loaded. If your installed OpenCode rejects these fields, consult that version's schema and migrate the config; the template preserves the source project's V2 format rather than assuming every OpenCode release accepts it. No live agent run was performed during extraction.

Try `/vehicle-search Find Tesla vehicles insured for customer C001` for the unchanged example. For your own domain use the renamed slash command. Inspect the completed shell tool event, process status and actual parsed JSON; model prose alone cannot establish success. If an existing session follows old guidance, start a new session.

## 8. Run the vehicle example

With demo configuration in place, start these yourself in separate terminals from the project root:

```sh
# Terminal 1
node dist/mock.js catalog 4010
```

```sh
# Terminal 2
node dist/mock.js insured 4011
```

Then search directly, or launch OpenCode in a third terminal:

```sh
node dist/cli.js vehicles search --brand Tesla --as-of 2025-06-01
node dist/cli.js insured search --plate-number 'ZH 638871'
node dist/cli.js combined search --customer-number C001 --brand Tesla --as-of 2025-06-01
opencode
```

The fixture catalog has two Teslas; the example join for C001 also yields two at that date. These are expected fixture results, not evidence of a live run. Fixture `in-004` references a missing vehicle to exercise visible lookup failure handling.

If the original harness already owns ports 4010/4011, leave it running and choose unused ports (for example 4110/4111) for this template. Change this project's private URL settings accordingly. Do not stop the original services. Stop only your own foreground demo processes with Ctrl-C when finished. For real APIs, your service operator manages lifecycle; the harness only makes requests.

## 9. Verify deliberately

| Check | Command | Side effects / prerequisites |
| --- | --- | --- |
| Static baseline | `npm run check:static` | Build, static scan, architecture checks; no listener or credentials |
| CLI contract | `node dist/cli.js --help` and `config check` | Local only; config check loads configuration |
| Full tests | `npm test` | Starts temporary HTTP/mock/OAuth test servers; run only when authorized |
| Packed installation | `npm run verify:install` | Temporary package installation and mock services; requires explicit authorization |
| Agent integration | `npm run verify:opencode` | Build, saved login, expected running mocks and OpenCode; read verifier prerequisites first |
| Packed agent integration | `npm run verify:install -- --opencode` | Temporary install/mocks plus actual OpenCode; may start a private OpenCode service unless `VEHICLE_OPENCODE_STANDALONE=0` |

Verification subprocesses must keep the child `PWD` aligned with `cwd`: OpenCode 2.2.5 run uses `PWD` when choosing project configuration. The shared subprocess helper handles this, including temporary packed installations. Do not work around a wrong project by broadening permissions.

The agent verifier is tailored to the original authenticated fixture flow; the no-login demo is not a substitute. Update scripts and expected fixture assertions for your domain/model/session before relying on them. `VEHICLE_OPENCODE_MODEL` selects a model; `VEHICLE_OPENCODE_EVIDENCE` optionally saves raw events, which should be treated as private review artifacts. Avoid inherited historical success claims.

Before release verify malformed/unknown/duplicate filters, empty pages, upstream failures/timeouts, expired credentials, pagination across API boundaries, joins with missing records and safe error output. Prove the actual packed executable and real agent flow separately from source tests. Live identity-provider and production API compatibility require their own authorized checks.

## Troubleshooting

- Connection error / exit 4: confirm the configured service is running and reachable; report the structured error. Do not silently launch services or bypass auth.
- Authentication error / exit 3: user runs `auth login`; check OAuth client, scopes, callback URI and keyring access. Never paste tokens or callback authorization codes.
- Configuration error / exit 2: check workdir or `--env`, required settings and overriding shell variables.
- Stale behavior: rebuild, reinstall a copied global CLI, and start a fresh OpenCode session.
- Global CLI mismatch: use relative `node dist/cli.js` until unique executable names are installed.
