#!/usr/bin/env node
import { Command } from 'commander'
import { add } from './changesets/index.js'

const program = new Command()

/**
 * @description
 * use changesets
 */
program
  .command('changesets')
  .alias('cs')
  .action((_options, command) => {
    add({ args: command.args })
  })

program.parse()
