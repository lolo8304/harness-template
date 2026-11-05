import {test} from "node:test";
import assert from "node:assert/strict";
import {VehicleClient} from "../../dist/vehicles/client.js";
import {insured, vehicles} from "../../dist/vehicles/fixtures.js";

test("combined lookup keeps malformed/missing records as errors and propagates authentication failures", async (t) => {
    let unauthorized = false;
    t.mock.method(globalThis, "fetch", async (raw) => {
        const url = new URL(raw);
        if (url.pathname === "/insured-vehicles")
            return Response.json({
                items: insured,
                total: insured.length,
                page: 1,
                limit: 1000,
            });
        if (unauthorized) return new Response("", {status: 401});
        const id = decodeURIComponent(url.pathname.split("/").at(-1));
        if (id === "ve-002") return Response.json({vehicleId: id});
        const fixture = vehicles.find((v) => v.vehicleId === id);
        if (!fixture) return new Response("", {status: 404});
        const {prices, ...fields} = fixture;
        return Response.json({
            ...fields,
            purchasePrice: {
                amount: prices.at(-1).amount,
                currency: "CHF",
                asOfDate: url.searchParams.get("asOfDate"),
            },
        });
    });
    const client = new VehicleClient(
        {
            catalogUrl: "https://catalog.example.test",
            insuredUrl: "https://insured.example.test",
            timeoutMs: 100,
        },
        async () => "test-token",
    );
    const page = await client.search("combined", {});
    assert.equal(page.total, 4);
    assert.equal(page.items[0].vehicle.vehicleId, "ve-001");
    assert.equal(page.items[2].vehicleLookupError.code, "API");
    assert.equal(
        page.items[2].vehicleLookupError.message,
        "Invalid vehicle detail response",
    );
    assert.equal(page.items[3].vehicleLookupError.status, 404);
    unauthorized = true;
    await assert.rejects(
        client.search("combined", {}),
        (error) => error.code === "AUTH",
    );
});

test("pure mock routing preserves filters and structured failure status without opening sockets", async () => {
    const {mockResponse} = await import("../../dist/mock.js");
    const catalog = mockResponse(
        "catalog",
        "GET",
        "/vehicles?brand=tes&mode=match&asOfDate=2025-06-01",
    );
    assert.equal(catalog.total, 2);
    assert.equal(catalog.items[0].purchasePrice.amount, 38000);
    assert.equal(
        mockResponse("insured", "GET", "/insured-vehicles?plateNumber=zh%20638871")
            .total,
        1,
    );
    for (const [kind, method, path, code, status] of [
        ["catalog", "POST", "/vehicles", "API", 405],
        ["catalog", "GET", "/unknown", "API", 404],
        ["catalog", "GET", "/vehicles/missing", "API", 404],
        ["catalog", "GET", "/vehicles/ve-001?asOfDate=1900-01-01", "API", 422],
        ["catalog", "GET", "/vehicles?page=1&page=2", "VALIDATION", undefined],
        ["catalog", "GET", "/vehicles/ve-001?page=1", "VALIDATION", undefined],
    ])
        assert.throws(
            () => mockResponse(kind, method, path),
            (error) => error.code === code && error.status === status,
        );
});

test("CLI and mock command validation still return JSON errors and exit 2", async () => {
    const {execWithClosedStdin} = await import("../../scripts/common/subprocess.mjs");
    for (const args of [
        ["dist/cli.js"],
        ["dist/cli.js", "unknown"],
        ["dist/mock.js", "invalid"],
        ["dist/mock.js", "catalog", "-1"],
    ]) {
        await assert.rejects(
            execWithClosedStdin(process.execPath, args, {timeout: 1000}),
            (error) =>
                error.code === 2 &&
                error.stdout === "" &&
                JSON.parse(error.stderr).error.code === "VALIDATION",
        );
    }
});
