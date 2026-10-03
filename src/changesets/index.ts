import { createRequire } from 'module'
import spawn from '@npmcli/promise-spawn'

/**
 * @zh 默认处理逻辑
 * @en default handler
 */
export const add = async ({ command }: { command?: string }) => {
  const require = createRequire(import.meta.url)
  const changesets = require.resolve('@changesets/cli/bin.js')
  const args: string[] = []

  if (command) {
    args.push(command)
  }

  await spawn('node', [changesets, ...args], {
    stdio: 'inherit'
  }).catch((error) => {
    console.log(error.stderr)
    return null
  })
}
