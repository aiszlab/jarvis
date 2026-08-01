import { createRequire } from "module";
import spawn from "@npmcli/promise-spawn";

/**
 * default handler
 */
export const add = async ({ command }: { command?: string }) => {
  const require = createRequire(import.meta.url);
  const changesets = require.resolve("@changesets/cli/bin.js");

  await spawn("node", [changesets, ...(command ? [command] : [])], {
    stdio: "inherit",
  }).catch((error) => {
    console.log(error.stderr);
    return null;
  });
};
