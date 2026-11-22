import { createRequire } from 'module'
import spawn from '@npmcli/promise-spawn'

/**
 * @zh 默认处理逻辑
 * @en default handler
 */
export const add = async ({
  command,
  options
}: {
  command?: string
  options?: { version?: boolean }
}) => {
  const require = createRequire(import.meta.url)
  const changesets = require.resolve('@changesets/cli/bin.js')
  const args: string[] = []

  const changesetsCommand = command ?? (options?.version ? 'version' : undefined)

  if (changesetsCommand) {
    args.push(changesetsCommand)
  }

  await spawn('node', [changesets, ...args], {
    stdio: 'inherit'
  }).catch((error) => {
    console.log(error.stderr)
    return null
  })
}
