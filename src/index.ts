#!/usr/bin/env node
import { Command } from "commander";
import { add } from "./changesets/index.js";
import { setupDev } from "./setup/index.js";
import { remove } from "./remove/index.js";
import { switchPlatform } from "./switch/index.js";

const program = new Command();

/**
 * @description
 * use changesets
 */
program
  .command("changesets")
  .alias("cs")
  .argument("[command]")
  .action((command?: string) => {
    add({ command });
  });

/**
 * @description
 * initialize dev environment (pnpm + claude-code)
 */
program
  .command("setup")
  .action(() => {
    setupDev();
  });

/**
 * @description
 * switch platform & model, outputs export commands
 *
 * usage: eval "$(jar switch)"
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

program.parse();
