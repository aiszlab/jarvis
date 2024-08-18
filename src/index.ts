#!/usr/bin/env node
import { Command } from 'commander'
import { add } from './changeset/index.js'

const program = new Command()

/**
 * @description
 * use changeset docs
 */
program.command('changeset').action(() => {
  add()
})

program.parse()
