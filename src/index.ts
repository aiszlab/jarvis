#!/usr/bin/env node
import { Command } from "commander";
import { add } from "./changesets/index.js";
import { setupDev } from "./setup/index.js";
import { remove } from "./remove/index.js";
import { switchPlatform } from "./switch/index.js";

const program = new Command();

/**
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
 * initialize dev environment (pnpm + claude-code)
 */
program.command("setup").action(() => {
  setupDev();
});

/**
 * switch platform & model, persists config to ~/.claude/settings.json
 */
program
  .command("switch")
  .alias("sw")
  .action(() => {
    switchPlatform();
  });

/**
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
