import {} from '@changesets/cli'
import { createRequire } from 'module'
import spawn from '@npmcli/promise-spawn'

/**
 * @description
 * default handler
 */
export const add = async () => {
  const require = createRequire(import.meta.url)
  const changesets = require.resolve('@changesets/cli/bin')

  await spawn('node', [changesets]).catch(() => null)
}
