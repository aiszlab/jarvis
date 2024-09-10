#!/usr/bin/env node
import { Command } from 'commander'
import { add } from './changesets/index.js'
import { remove, type RemoveBy } from './remove/index.js'

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

/**
 * @description
 * use remove
 */
program
  .command('remove')
  .alias('rm')
  .option('-r, --recursive', 'remove in every folder a workspace')
  .action((...args) => {
    console.log('args=====', args)
    remove()
  })

program.parse()
