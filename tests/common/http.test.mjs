import {test} from "node:test";
import assert from "node:assert/strict";
import {requestJson} from "../../dist/common/http.js";

test("HTTP client preserves successful JSON and empty revocation responses", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response('{"ok":true}'));
    assert.deepEqual(await requestJson("https://api.example.test", {}, 100), {
        ok: true,
    });
    globalThis.fetch = async () => new Response("");
    assert.deepEqual(
        await requestJson("https://api.example.test", {}, 100, true),
        {},
    );
});

test("HTTP response validation keeps API/auth classification and hides response contents", async (t) => {
    t.mock.method(
        globalThis,
        "fetch",
        async () => new Response("secret-token", {status: 503}),
    );
    for (const [status, auth, expected] of [
        [503, false, "API"],
        [401, false, "AUTH"],
        [403, false, "AUTH"],
        [400, true, "AUTH"],
    ]) {
        globalThis.fetch = async () => new Response("secret-token", {status});
        await assert.rejects(
            requestJson("https://api.example.test", {}, 100, auth),
            (e) =>
                e.code === expected &&
                e.status === status &&
                !e.message.includes("secret"),
        );
    }
    for (const response of [
        () => new Response(null),
        () => new Response("secret-invalid-json"),
        () => new Response("x".repeat(2_000_001)),
    ]) {
        for (const auth of [false, true]) {
            globalThis.fetch = async () => response();
            await assert.rejects(
                requestJson("https://api.example.test", {}, 100, auth),
                (e) =>
                    e.code === (auth ? "AUTH" : "API") && !e.message.includes("secret"),
            );
        }
    }
});

test("HTTP transport failures during fetch and body reading remain redacted NETWORK errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
        throw new Error("secret-token transport error");
    });
    await assert.rejects(
        requestJson("https://api.example.test", {}, 100),
        (e) => e.code === "NETWORK" && e.message === "Request failed or timed out",
    );
    globalThis.fetch = async () =>
        new Response(
            new ReadableStream({
                start(controller) {
                    controller.error(new Error("secret-token stream error"));
                },
            }),
        );
    await assert.rejects(
        requestJson("https://api.example.test", {}, 100, true),
        (e) => e.code === "NETWORK" && !e.message.includes("secret"),
    );
});
