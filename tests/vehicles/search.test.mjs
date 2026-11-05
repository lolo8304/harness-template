import {test} from "node:test";
import assert from "node:assert/strict";
import {startMock} from "../../dist/mock.js";
import {matchesVehicle, parseSearch} from "../../dist/vehicles/search.js";

test("catalog API filters, prices, pagination and GET-only contract", async (t) => {
    const mock = await startMock("catalog", 0);
    t.after(() => mock.close());
    const get = async (query) => {
        const r = await fetch(`${mock.url}/vehicles${query}`);
        return [r.status, await r.json()];
    };
    let [status, data] = await get("?brand=tes&model=MODEL&mode=match&seats=5");
    assert.equal(status, 200);
    assert.equal(data.total, 2);
    for (const item of data.items) {
        assert.equal(item.purchasePrice.currency, "CHF");
        assert.match(item.registrationNumber, /^[a-z0-9]{8}$/i);
    }
    assert.equal((await get("?brand=tes&mode=exact"))[1].total, 0);
    assert.equal((await get("?vin=VIN&mode=match"))[1].total, 0);
    assert.equal((await get("?vehicleId=ve-001&brand=BMW"))[1].total, 0);
    assert.equal(
        (await get("?registrationNumber=ZX123ABC"))[1].items[0].vehicleId,
        "ve-001",
    );
    assert.equal(
        (
            await get(
                "?modelYear=2024&vehicleType=suv&firstRegistrationDate=2024-03-01&seats=5",
            )
        )[1].items[0].vehicleId,
        "ve-002",
    );
    data = (await get("?vehicleId=ve-001&asOfDate=2024-06-01"))[1];
    assert.deepEqual(data.items[0].purchasePrice, {
        amount: 42000,
        currency: "CHF",
        asOfDate: "2024-06-01",
    });
    assert.equal(
        (await get("?vehicleId=ve-001&asOfDate=2025-06-01"))[1].items[0]
            .purchasePrice.amount,
        38000,
    );
    data = (await get("?page=2&limit=1"))[1];
    assert.equal(data.page, 2);
    assert.equal(data.items.length, 1);
    assert.equal(data.total, 3);
    assert.equal((await get("?page=99&limit=1"))[1].items.length, 0);
    for (const query of [
        "?page=0",
        "?limit=2.5",
        "?mode=other",
        "?asOfDate=2024-02-30",
        "?registrationNumber=bad",
        "?unknown=1",
        "?page=1&page=2",
        "?seats=NaN",
    ]) {
        const [code, body] = await get(query);
        assert.equal(code, 400, query);
        assert.equal(body.error.code, "VALIDATION");
    }
    assert.equal(
        (await fetch(`${mock.url}/vehicles/ve-001?asOfDate=2025-06-01`)).status,
        200,
    );
    assert.equal((await fetch(`${mock.url}/vehicles/missing`)).status, 404);
    assert.equal(
        (await fetch(`${mock.url}/vehicles`, {method: "POST"})).status,
        405,
    );
    assert.equal((await get("?asOfDate=1900-01-01"))[0], 422);
});

test("insured filters are exact, ANDed, and normalize plates only", async (t) => {
    const mock = await startMock("insured", 0);
    t.after(() => mock.close());
    const get = async (query) =>
        (await fetch(`${mock.url}/insured-vehicles?${query}`)).json();
    assert.equal(
        (
            await get(
                "plateNumber=%20zh%20638871%20&customerNumber=C001&policyNumber=P001&vehicleId=ve-001",
            )
        ).total,
        1,
    );
    assert.equal((await get("customerNumber=c001")).total, 0);
    assert.equal((await get("plateNumber=ZH")).total, 0);
    assert.equal((await get("customerNumber=C001&policyNumber=P002")).total, 0);
    assert.equal((await get("limit=1&page=2")).items[0].id, "in-002");
});

test("shared validator rejects malformed values and preserves exact identifiers", () => {
    assert.throws(() => parseSearch({modelYear: "2024x"}, "vehicles"));
    assert.throws(() => parseSearch({asOfDate: "2025-13-01"}, "vehicles"));
    assert.throws(() => parseSearch({brand: ""}, "vehicles"));
    assert.throws(() => parseSearch({brand: "Tesla"}, "insured"));
    const filters = parseSearch(
        {brand: "tes", vin: "VIN", mode: "match"},
        "vehicles",
    );
    assert.equal(
        matchesVehicle({brand: "Tesla", vin: "VIN123"}, filters),
        false,
    );
});
