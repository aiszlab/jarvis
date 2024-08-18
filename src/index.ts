#!/usr/bin/env node
import { Command } from 'commander'
import { add } from './changesets/index.js'

const program = new Command()

/**
 * @description
 * use changeset docs
 */
program.command('changesets').action((options, command) => {
  add({ args: command.args })
})

program.parse()
