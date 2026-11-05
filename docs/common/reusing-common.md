# Reusing the common code

`src/common` contains domain-independent modules and never imports `src/vehicles`. Its public package entry point is `harness-template/common`. Importing this library does not start a CLI, browser, HTTP listener, or credential-store operation.

## Shared utilities

```ts
import {
  AppError,
  dateValue,
  positiveInteger,
  paginate,
  requestJson,
} from "harness-template/common";
import type { Page } from "harness-template/common";

const page: Page<string> = paginate(["a", "b", "c"], { page: 2, limit: 1 });
const date = dateValue("2026-11-05");
const limit = positiveInteger("20", "limit", 1000);
```

The generic paginator accepts any item type and only requires `{page, limit}`. Vehicle field validation and search matching remain in the vehicle module.

## OAuth and credential storage

`Auth` accepts an explicit configuration and a `Store` interface. Another domain can provide its own issuer/client/scopes and storage; it does not need vehicle API configuration.

```ts
import {
  Auth,
  FileStore,
  credentialContext,
} from "harness-template/common";

const issuer = process.env.MY_OAUTH_ISSUER!;
const clientId = process.env.MY_OAUTH_CLIENT_ID!;
const store = new FileStore(
  "/absolute/private/my-app/credentials.json",
  credentialContext(issuer, clientId),
);
const auth = new Auth({
  issuer,
  clientId,
  scopes: "openid profile offline_access",
  callbackPort: 8765,
}, store);

// These are explicit operations, not import side effects:
// await auth.login();
// const token = await auth.token();
```

The file example requires a POSIX owner-only directory/file. Use `KeyringStore` for native credential storage, or implement the exported `Store` interface. Keep issuer/client context separation and avoid logging tokens. Register the configured callback URI with your provider. The generic OAuth implementation requires compatible discovery metadata and authorization-code/PKCE support.

`authConfig` and `createStore` remain available as compatibility environment adapters. They retain this CLI's existing `CLERK_OAUTH_*` and `VEHICLE_*` names/defaults, with the template keyring namespace and default file directory isolated under `harness-template`. For an independently configured application, prefer explicit `Auth`/store construction or supply an application-specific environment mapping; no vehicle records or API URLs are required by the common classes.

## Domain-specific documentation

See [vehicle client and mock reuse](../vehicles/reusing-vehicles.md) for catalog/insurance-specific imports. Domain models, fixtures and search rules are kept out of the shared modules.

Install the release tarball in another Node.js 24+ project with `npm install /path/to/harness-template-0.1.0.tgz` to use the public library imports. Type declarations are included alongside the compiled modules. Keep imports on public entry points instead of reaching into `dist/`.

Shared authentication, HTTP and subprocess tests live in `tests/common`; shared subprocess/static-check scripts live in `scripts/common`. Domain integration tests/scripts are kept in their respective `vehicles` folders. The compiler and warning checker recurse into both source folders.
