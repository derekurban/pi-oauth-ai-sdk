import { stderr } from "node:process";

import { runCli } from "./cli-app.js";

runCli(process.argv.slice(2)).catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
