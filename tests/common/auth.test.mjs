import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {connect} from "node:net";
import {createHash} from "node:crypto";
import {chmod, mkdtemp, readFile, rm, stat, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Auth} from "../../dist/common/auth.js";
import {createStore, FileStore} from "../../dist/common/credentials.js";

async function provider(t) {
    const calls = [];
    let base;
    const server = createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/.well-known/oauth-authorization-server")
            return res.end(
                JSON.stringify({
                    issuer: base,
                    authorization_endpoint: base + "/authorize",
                    token_endpoint: base + "/token",
                    revocation_endpoint: base + "/revoke",
                }),
            );
        let text = "";
        for await (const chunk of req) text += chunk;
        const body = new URLSearchParams(text);
        calls.push({path: req.url, body});
        if (req.url === "/revoke") return res.end("{}");
        if (body.get("code") === "invalid") {
            res.statusCode = 400;
            return res.end('{"error":"access-token-must-not-leak"}');
        }
        res.end(
            JSON.stringify({
                access_token: "access-secret",
                refresh_token:
                    body.get("grant_type") === "refresh_token"
                        ? "rotated-secret"
                        : "refresh-secret",
                expires_in: 3600,
                token_type: "Bearer",
            }),
        );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    return {base, calls};
}

function memory() {
    let value;
    return {
        read: async () => value,
        write: async (v) => {
            value = v;
        },
        clear: async () => {
            value = undefined;
        },
    };
}

function config(issuer) {
    return {
        issuer,
        clientId: "public-client",
        scopes: "openid profile",
        timeoutMs: 500,
        loginTimeoutMs: 1000,
    };
}

test("PKCE login validates state, exchanges code, stores tokens, refreshes and revokes", async (t) => {
    const p = await provider(t);
    const store = memory();
    const cfg = config(p.base);
    let authorization;
    const auth = new Auth(cfg, store, async (raw) => {
        authorization = new URL(raw);
        const redirect = new URL(authorization.searchParams.get("redirect_uri"));
        const malformed = await new Promise((resolve, reject) => {
            const socket = connect(Number(redirect.port), "127.0.0.1", () =>
                socket.write(
                    "GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                ),
            );
            let response = "";
            socket.on("data", (chunk) => (response += chunk));
            socket.on("end", () => resolve(response));
            socket.on("error", reject);
        });
        assert.match(malformed, /HTTP\/1.1 400/);
        assert.equal(redirect.hostname, "127.0.0.1");
        assert.notEqual(redirect.port, "");
        assert.equal(
            authorization.searchParams.get("code_challenge_method"),
            "S256",
        );
        assert.equal(authorization.searchParams.get("client_secret"), null);
        const bad = new URL(redirect);
        bad.searchParams.set("state", "wrong");
        bad.searchParams.set("code", "stolen");
        assert.equal((await fetch(bad)).status, 400);
        bad.searchParams.set(
            "state",
            "é".repeat(authorization.searchParams.get("state").length),
        );
        assert.equal((await fetch(bad)).status, 400);
        const good = new URL(redirect);
        good.searchParams.set("state", authorization.searchParams.get("state"));
        good.searchParams.set("code", "valid");
        assert.equal((await fetch(good)).status, 200);
    });
    await auth.login();
    const exchange = p.calls.find((c) => c.path === "/token").body;
    assert.equal(
        createHash("sha256")
            .update(exchange.get("code_verifier"))
            .digest("base64url"),
        authorization.searchParams.get("code_challenge"),
    );
    assert.equal(
        exchange.get("redirect_uri"),
        authorization.searchParams.get("redirect_uri"),
    );
    assert.equal(await auth.token(), "access-secret");
    const status = await auth.status();
    assert.equal(status.authenticated, true);
    assert.equal(JSON.stringify(status).includes("secret"), false);
    await store.write({...(await store.read()), expiresAt: 0});
    assert.equal(await auth.token(), "access-secret");
    assert.equal(p.calls.at(-1).body.get("refresh_token"), "refresh-secret");
    await auth.logout();
    assert.equal(await store.read(), undefined);
    assert.equal(p.calls.filter((c) => c.path === "/revoke").length, 2);
    assert.equal((await auth.status()).authenticated, false);
});

test("OAuth denial, failed exchange and timeout are safe and close callback", async (t) => {
    const p = await provider(t);
    for (const mode of ["denied", "exchange", "timeout"]) {
        let callback;
        const auth = new Auth(
            {...config(p.base), loginTimeoutMs: 100},
            memory(),
            async (raw) => {
                const u = new URL(raw);
                callback = new URL(u.searchParams.get("redirect_uri"));
                if (mode === "timeout") return;
                callback.searchParams.set("state", u.searchParams.get("state"));
                if (mode === "denied")
                    callback.searchParams.set("error", "secret-denial");
                else callback.searchParams.set("code", "invalid");
                await fetch(callback);
            },
        );
        await assert.rejects(
            auth.login(),
            (e) => e.code === "AUTH" && !e.message.includes("secret"),
        );
        await assert.rejects(fetch(callback));
    }
});

test("owner-only file store persists atomically, rejects insecure files and symlinks", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "vehicle-auth-"));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const path = join(dir, "private", "credentials.json");
    const store = new FileStore(path, "context");
    assert.equal(await store.read(), undefined);
    const tokens = {
        accessToken: "secret",
        refreshToken: "refresh",
        expiresAt: 123,
        context: "context",
    };
    await store.write(tokens);
    assert.deepEqual(await store.read(), tokens);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, "private"))).mode & 0o777, 0o700);
    assert.equal(await new FileStore(path, "other").read(), undefined);
    await chmod(path, 0o644);
    await assert.rejects(store.read(), (e) => e.code === "AUTH");
    await chmod(path, 0o600);
    const link = join(dir, "link");
    await symlink(path, link);
    await assert.rejects(
        new FileStore(link, "context").read(),
        (e) => e.code === "AUTH",
    );
    await store.clear();
    await assert.rejects(readFile(path));
});

test("missing/invalid credentials and issuer configuration fail safely", async () => {
    await assert.rejects(
        new Auth({}, memory()).token(),
        (e) => e.code === "AUTH",
    );
    await assert.rejects(
        new Auth(
            {issuer: "http://example.com", clientId: "client"},
            memory(),
        ).login(),
        (e) => e.code === "VALIDATION",
    );
    assert.throws(
        () => createStore({VEHICLE_CREDENTIAL_STORE: "wrong"}),
        (e) => e.code === "VALIDATION",
    );
});

test("login timeout aborts a running browser launcher child process", async (t) => {
    const {execFile} = await import("node:child_process");
    const p = await provider(t);
    let child;
    let closed;
    const auth = new Auth(
        {...config(p.base), loginTimeoutMs: 50},
        memory(),
        (_url, signal) =>
            new Promise((resolve, reject) => {
                child = execFile(
                    process.execPath,
                    ["-e", "setInterval(()=>{},1000)"],
                    {signal},
                    (error) => (error ? reject(error) : resolve()),
                );
                closed = new Promise((r) => child.once("close", r));
            }),
    );
    t.after(() => child?.kill());
    await assert.rejects(auth.login(), (e) => e.code === "AUTH");
    assert.equal(
        await Promise.race([
            closed.then(() => true),
            new Promise((r) => setTimeout(() => r(false), 300)),
        ]),
        true,
    );
});

test("logout clears local credentials even when stored data cannot be decoded", async () => {
    let cleared = false;
    const store = {
        read: async () => {
            const error = new Error("invalid store");
            error.code = "AUTH";
            throw error;
        },
        write: async () => {
        },
        clear: async () => {
            cleared = true;
        },
    };
    await assert.rejects(new Auth({}, store).logout());
    assert.equal(cleared, true);
});

test("fixed callback port is bound, used for authorization and token exchange, then released", async (t) => {
    const p = await provider(t);
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const auth = new Auth(
        {...config(p.base), callbackPort: port},
        memory(),
        async (raw) => {
            const u = new URL(raw);
            const redirect = new URL(u.searchParams.get("redirect_uri"));
            assert.equal(redirect.href, `http://127.0.0.1:${port}/callback`);
            redirect.searchParams.set("state", u.searchParams.get("state"));
            redirect.searchParams.set("code", "valid");
            assert.equal((await fetch(redirect)).status, 200);
        },
    );
    await auth.login();
    assert.equal(
        p.calls.find((c) => c.path === "/token").body.get("redirect_uri"),
        `http://127.0.0.1:${port}/callback`,
    );
    await new Promise((r) => probe.listen(port, "127.0.0.1", r));
    await new Promise((r) => probe.close(r));
});

test("occupied fixed callback port reports AUTH without opening a browser or changing ports", async (t) => {
    const p = await provider(t);
    const occupied = createServer();
    await new Promise((r) => occupied.listen(0, "127.0.0.1", r));
    t.after(() => new Promise((r) => occupied.close(r)));
    let launched = false;
    const auth = new Auth(
        {...config(p.base), callbackPort: occupied.address().port},
        memory(),
        async () => {
            launched = true;
        },
    );
    await assert.rejects(
        auth.login(),
        (e) => e.code === "AUTH" && e.message.includes("callback"),
    );
    assert.equal(launched, false);
});

test("authorization failures report recognized error codes without callback descriptions or tokens", async (t) => {
    const p = await provider(t);
    for (const code of [
        "invalid_scope",
        "access_denied",
        "unauthorized_client",
        "invalid_request",
        "unknown-secret-code",
    ]) {
        const auth = new Auth(config(p.base), memory(), async (raw) => {
            const u = new URL(raw);
            const callback = new URL(u.searchParams.get("redirect_uri"));
            callback.searchParams.set("state", u.searchParams.get("state"));
            callback.searchParams.set("error", code);
            callback.searchParams.set(
                "error_description",
                "secret-access-token-in-description",
            );
            await fetch(callback);
        });
        await assert.rejects(
            auth.login(),
            (e) =>
                e.code === "AUTH" &&
                !e.message.includes("secret") &&
                (code === "unknown-secret-code" || e.message.includes(code)),
        );
    }
    assert.equal(p.calls.length, 0);
});
