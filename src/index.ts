#!/usr/bin/env node
import { Command } from "commander";
import { add } from "./changesets/index.js";
import { remove } from "./remove/index.js";

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
