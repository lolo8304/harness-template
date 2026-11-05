# Harness template

A reusable Node.js 24+ / TypeScript harness, extracted from the vehicle-search project. The working vehicle example is retained so you can build it first, then replace the domain. OpenCode invokes the CLI through its shell tool; no MCP server is required.

Start with [Create your own harness](docs/template/create-your-own-harness.md). It covers setup, adaptation, APIs, authentication, build/install, OpenCode, running and verification.

```sh
npm ci
npm run check:static
cp .env.example .env
chmod 600 .env
node dist/cli.js config check
```

These steps do not start services. Start the demo APIs yourself as described in the guide before searching. The example configuration uses mock mode and needs no login.

Package name: `harness-template`. Example executable names remain `vehicle-cli` and `vehicle-mock`; use `node dist/cli.js` until you deliberately rename/install them to avoid colliding with an existing vehicle CLI. Default credential storage is isolated under `harness-template`.

Only maintained code, tests, scripts and selected guidance were copied. Private configuration, credentials, installed dependencies, compiled outputs, editor state, Git history and historical verification evidence were excluded. Template creation does not establish live OAuth, production API or OpenCode compatibility.

See the [end-to-end verification report](docs/template/end-to-end-verification.md) for the independent mock/API/OpenCode run and the separate packed-agent limitation.
