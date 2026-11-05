#!/usr/bin/env node
import {pathToFileURL} from "node:url";
import {realpathSync} from "node:fs";
import {runMockCli} from "./vehicles/mock.js";

export {startMock, mockResponse} from "./vehicles/mock.js";
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
    await runMockCli();
