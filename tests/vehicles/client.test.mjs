import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {startMock} from "../../dist/mock.js";
import {VehicleClient} from "../../dist/vehicles/client.js";

const exec = promisify(execFile);
const cli = (args, env = {}) =>
    exec(process.execPath, ["dist/cli.js", ...args], {
        env: {...process.env, ...env},
    });

test("client searches both APIs and joins before pagination, preserving missing lookups", async (t) => {
    const catalog = await startMock("catalog");
    const insured = await startMock("insured");
    t.after(async () => {
        await catalog.close();
        await insured.close();
    });
    const client = new VehicleClient(
        {catalogUrl: catalog.url, insuredUrl: insured.url, timeoutMs: 1000},
        async () => "test-token",
    );
    let result = await client.search("combined", {
        brand: "tes",
        mode: "match",
        page: 2,
        limit: 1,
    });
    // BMW appears between Tesla records, so paging insured first would return the wrong result.
    assert.equal(result.total, 3);
    assert.equal(result.items[0].vehicle.vehicleId, "ve-002");
    result = await client.search("combined", {
        limit: 1,
        page: 3,
        brand: "tes",
        mode: "match",
    });
    assert.equal(result.items[0].insured.id, "in-004");
    assert.equal(result.items[0].vehicleLookupError.status, 404);
    assert.equal(
        (
            await client.search("combined", {
                customerNumber: "C001",
                brand: "Tesla",
            })
        ).total,
        2,
    );
    assert.equal(
        (await client.search("vehicles", {brand: "BMW"})).items[0].vehicleId,
        "ve-003",
    );
    assert.equal(
        (await client.search("insured", {policyNumber: "P003"})).items[0].id,
        "in-003",
    );
});

test("client forwards bearer tokens, protects errors and checks response shape", async (t) => {
    let route = "ok";
    const server = createServer((req, res) => {
        assert.equal(req.headers.authorization, "Bearer secret-token");
        if (route === "slow") return setTimeout(() => res.end("{}"), 150);
        res.setHeader("Content-Type", "application/json");
        if (route === "auth") {
            res.statusCode = 401;
            return res.end("secret-token");
        }
        if (route === "api") {
            res.statusCode = 503;
            return res.end("secret-token");
        }
        if (route === "bad") return res.end('{"items":[],"total":-1}');
        if (route === "baditem")
            return res.end('{"items":[{}],"total":1,"page":1,"limit":20}');
        res.end('{"items":[],"total":0,"page":1,"limit":20}');
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const client = new VehicleClient(
        {catalogUrl: url, insuredUrl: url, timeoutMs: 40},
        async () => "secret-token",
    );
    assert.equal((await client.search("vehicles", {})).total, 0);
    for (const [r, code] of [
        ["auth", "AUTH"],
        ["api", "API"],
        ["bad", "API"],
        ["baditem", "API"],
        ["slow", "NETWORK"],
    ]) {
        route = r;
        await assert.rejects(
            client.search("vehicles", {}),
            (e) => e.code === code && !e.message.includes("secret-token"),
        );
    }
});

test("CLI JSON output and validation/auth/network/API exit codes", async (t) => {
    const catalog = await startMock("catalog");
    const insured = await startMock("insured");
    t.after(async () => {
        await catalog.close();
        await insured.close();
    });
    const env = {
        VEHICLE_MOCK: "1",
        VEHICLE_CATALOG_URL: catalog.url,
        VEHICLE_INSURED_URL: insured.url,
    };
    const {stdout, stderr} = await cli(
        ["combined", "search", "--brand", "tes", "--mode", "match", "--limit", "1"],
        env,
    );
    assert.equal(stderr, "");
    assert.equal(JSON.parse(stdout).items[0].vehicle.brand, "Tesla");
    for (const args of [
        ["vehicles", "search", "--page", "0"],
        ["vehicles", "search", "--wat"],
        ["unknown"],
        ["vehicles", "search", "--as-of", "2024-02-30"],
        ["vehicles", "search", "--brand", "Tesla", "--brand", "BMW"],
    ]) {
        await assert.rejects(
            cli(args, env),
            (e) =>
                e.code === 2 &&
                e.stdout === "" &&
                JSON.parse(e.stderr).error.code === "VALIDATION",
        );
    }
    await assert.rejects(
        cli(["vehicles", "search"], {
            VEHICLE_MOCK: "0",
            VEHICLE_CREDENTIAL_STORE: "file",
            VEHICLE_CREDENTIAL_FILE: `${catalog.url.replaceAll("/", "_")}-missing.json`,
        }),
        (e) => e.code === 3,
    );
    await assert.rejects(
        cli(["vehicles", "search"], {
            ...env,
            VEHICLE_CATALOG_URL: "http://127.0.0.1:1",
        }),
        (e) => e.code === 4,
    );
    await assert.rejects(
        cli(["vehicles", "search"], {
            ...env,
            VEHICLE_CATALOG_URL: "https://example.com",
        }),
        (e) => e.code === 2,
    );
    await assert.rejects(
        cli(["vehicles", "search", "--as-of", "1900-01-01"], env),
        (e) => e.code === 5,
    );
    assert.match((await cli(["--help"])).stdout, /combined/);
});

test("catalog client rejects a price returned for the wrong requested date", async (t) => {
    const catalog = await startMock("catalog");
    t.after(() => catalog.close());
    const page = await (
        await fetch(catalog.url + "/vehicles?asOfDate=2024-06-01")
    ).json();
    const server = createServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(page));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const client = new VehicleClient(
        {catalogUrl: url, insuredUrl: url, timeoutMs: 500},
        async () => "test",
    );
    await assert.rejects(
        client.search("vehicles", {asOfDate: "2025-06-01"}),
        (e) => e.code === "API",
    );
});

test("combined search crosses insured API page boundaries before final pagination", async (t) => {
    const catalog = await startMock("catalog");
    t.after(() => catalog.close());
    const pages = [];
    const records = Array.from({length: 1002}, (_, index) => ({
        id: `in-${index}`,
        plateNumber: `ZH ${index}`,
        customerNumber: "C001",
        policyNumber: `P${index}`,
        vehicleId: index === 0 ? "ve-003" : "ve-001",
    }));
    const server = createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        const page = Number(url.searchParams.get("page"));
        const limit = Number(url.searchParams.get("limit"));
        pages.push(page);
        res.end(
            JSON.stringify({
                items: records.slice((page - 1) * limit, page * limit),
                total: records.length,
                page,
                limit,
            }),
        );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const client = new VehicleClient(
        {
            catalogUrl: catalog.url,
            insuredUrl: `http://127.0.0.1:${server.address().port}`,
            timeoutMs: 500,
        },
        async () => "test",
    );
    const result = await client.search("combined", {
        brand: "Tesla",
        page: 1001,
        limit: 1,
    });
    assert.deepEqual(pages, [1, 2]);
    assert.equal(result.total, 1001);
    assert.equal(result.items[0].insured.id, "in-1001");
});
