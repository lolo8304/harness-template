import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyOpenCodeEvents} from "../../scripts/vehicles/opencode-evidence.mjs";

test("OpenCode verification requires successful shell output, not model claims", () => {
    const command = "vehicle-cli combined search --limit 1";
    const record = {
        total: 2,
        page: 2,
        limit: 1,
        items: [{vehicle: {vehicleId: "ve-002"}}],
    };
    const event = {
        type: "tool_use",
        part: {
            tool: "bash",
            state: {
                status: "completed",
                input: {command},
                output: JSON.stringify(record),
                metadata: {exit: 0},
            },
        },
    };
    verifyOpenCodeEvents(JSON.stringify(event), command);
    assert.throws(() =>
        verifyOpenCodeEvents(
            JSON.stringify({
                type: "text",
                part: {text: `Ran ${command}: ve-002`},
            }),
            command,
        ),
    );
    assert.throws(() =>
        verifyOpenCodeEvents(
            JSON.stringify({
                ...event,
                part: {
                    ...event.part,
                    state: {...event.part.state, metadata: {exit: 1}},
                },
            }),
            command,
        ),
    );
    assert.throws(() =>
        verifyOpenCodeEvents(JSON.stringify(event), "other command"),
    );
    assert.throws(() =>
        verifyOpenCodeEvents(
            JSON.stringify({
                ...event,
                part: {
                    ...event.part,
                    state: {...event.part.state, output: "ve-002"},
                },
            }),
            command,
        ),
    );
});

test("OpenCode V2 shell events require nested exit zero and real JSON output", () => {
    const command = "node dist/cli.js combined search --page 2 --limit 1";
    const state = {
        status: "completed",
        input: {command},
        output: JSON.stringify({
            total: 2,
            page: 2,
            limit: 1,
            items: [{vehicle: {vehicleId: "ve-002"}}],
        }),
        metadata: {metadata: {exit: 0}},
    };
    const event = {type: "tool_use", part: {tool: "shell", state}};
    verifyOpenCodeEvents(JSON.stringify(event), command);
    assert.throws(() =>
        verifyOpenCodeEvents(
            JSON.stringify({
                ...event,
                part: {
                    tool: "shell",
                    state: {...state, metadata: {metadata: {exit: 2}}},
                },
            }),
            command,
        ),
    );
});

test("OpenCode evidence can verify catalog and insured pages as well as combined pages", () => {
    const command = "node dist/cli.js vehicles search --brand Tesla";
    const event = {
        type: "tool_use",
        part: {
            tool: "shell",
            state: {
                status: "completed",
                input: {command},
                metadata: {metadata: {exit: 0}},
                output: JSON.stringify({
                    total: 2,
                    page: 1,
                    limit: 20,
                    items: [{vehicleId: "ve-001"}, {vehicleId: "ve-002"}],
                }),
            },
        },
    };
    verifyOpenCodeEvents(JSON.stringify(event), command, {
        total: 2,
        page: 1,
        limit: 20,
        vehicleIds: ["ve-001", "ve-002"],
    });
    assert.throws(() =>
        verifyOpenCodeEvents(JSON.stringify(event), command, {
            total: 2,
            page: 1,
            limit: 20,
            vehicleIds: ["wrong"],
        }),
    );
});
