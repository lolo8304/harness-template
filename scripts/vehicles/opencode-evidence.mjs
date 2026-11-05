import assert from "node:assert/strict";

/** Validate tool output itself; model text or failed/denied tool calls cannot prove integration. */
export function verifyOpenCodeEvents(
    raw,
    command,
    expected = {total: 2, page: 2, limit: 1, vehicleIds: ["ve-002"]},
) {
    const events = raw
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line)];
            } catch {
                return [];
            }
        });
    const proven = events.some((event) => {
        const part = event.part;
        const state = part?.state;
        if (
            event.type !== "tool_use" ||
            !["bash", "shell"].includes(part?.tool) ||
            state?.status !== "completed" ||
            state.input?.command !== command ||
            (state.metadata?.exit ?? state.metadata?.metadata?.exit) !== 0
        )
            return false;
        try {
            const page = JSON.parse(state.output);
            return (
                page.total === expected.total &&
                page.page === expected.page &&
                page.limit === expected.limit &&
                Array.isArray(page.items) &&
                JSON.stringify(
                    page.items.map((item) => item.vehicle?.vehicleId ?? item.vehicleId),
                ) === JSON.stringify(expected.vehicleIds)
            );
        } catch {
            return false;
        }
    });
    assert(
        proven,
        "No successful OpenCode shell tool event with the expected JSON page",
    );
}
