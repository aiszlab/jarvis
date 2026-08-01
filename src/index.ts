#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { add } from "./changesets/index.js";
import { setupDev } from "./setup/index.js";
import { remove } from "./remove/index.js";
import { switchPlatform } from "./switch/index.js";
import { kill } from "./kill/index.js";

const program = new Command();

/**
 * @description
 * use changesets
 */
program
  .command("changesets")
  .alias("cs")
  .option("-v, --version", "修订 changesets 版本")
  .argument("[command]")
  .action((command?: string, options?: { version?: boolean }) => {
    add({
      command: new Set([command, options?.version ? "version" : void 0])
        .values()
        .filter((i) => !!i)
        .toArray()
        .at(0),
    });
  });

/**
 * @description
 * initialize dev environment (pnpm + claude-code)
 */
program.command("setup").action(() => {
  setupDev();
});

/**
 * @description
 * switch platform & model, outputs export commands
 *
 * usage: eval "$(jrv switch)"
 */
program
  .command("switch")
  .alias("sw")
  .action(() => {
    switchPlatform();
  });

/**
 * @description
 * like `rm -rf`
 */
program
  .command("remove")
  .alias("rm")
  .argument("<pathname>")
  .action((pathname: string) => {
    remove(pathname);
  });

/**
 * @description
 * kill the process listening on a given port
 *
 * usage: `jrv kill 8080` or `jrv kill` (interactive prompt)
 */
program
  .command("kill")
  .alias("k")
  .argument("[port]", "port number", (value) => {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new InvalidArgumentError("port must be an integer in 0..65535");
    }
    return port;
  })
  .action(async (port?: number) => {
    await kill(port);
  });

program.parse();
