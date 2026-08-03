#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander'
import { add } from './changesets/index.js'
import { setupDev } from './setup/index.js'
import { remove } from './remove/index.js'
import { switchPlatform } from './switch/index.js'
import { kill } from './kill/index.js'
import { useEnv } from './use/index.js'

const program = new Command()

/**
 * use changesets
 */
program
  .command('changesets')
  .alias('cs')
  .option('-v, --version', '修订 changesets 版本')
  .option('-m, --message', '自动生成 changesets message')
  .argument('[command]')

  .action((command?: string, options?: { version?: boolean; message?: boolean }) => {
    add({
      command: new Set([command, options?.version ? 'version' : void 0])
        .values()
        .filter((i) => !!i)
        .toArray()
        .at(0)
    })
  })

/**
 * initialize dev environment (pnpm + claude-code)
 */
program.command('setup').action(() => {
  setupDev()
})

/**
 * switch platform & model, persists config to ~/.claude/settings.json
 */
program
  .command('switch')
  .alias('sw')
  .action(() => {
    switchPlatform()
  })

/**
 * like `rm -rf`
 */
program
  .command('remove')
  .alias('rm')
  .argument('<pathname>')
  .action((pathname: string) => {
    remove(pathname)
  })

/**
 * @description
 * kill the process listening on a given port
 *
 * usage: `jrv kill 8080` or `jrv kill` (interactive prompt)
 */
program
  .command('kill')
  .alias('k')
  .argument('[port]', 'port number', (value) => {
    const port = Number(value)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new InvalidArgumentError('port must be an integer in 0..65535')
    }
    return port
  })
  .action(async (port?: number) => {
    await kill(port)
  })

/**
 * @description
 * load environment variables from jarvis.settings.local.json interactively
 * and output export statements for shell eval.
 *
 * usage: `eval "$(jrv use)"`
 */
program.command('use').action(async () => {
  await useEnv()
})

program.parse()
