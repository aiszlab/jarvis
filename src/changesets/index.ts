import { createRequire } from 'module'
import spawn from '@npmcli/promise-spawn'

/**
 * @description
 * default handler
 */
export const add = async (options: { args: string[] }) => {
  const require = createRequire(import.meta.url)
  const changesets = require.resolve('@changesets/cli/bin.js')

  await spawn('node', [changesets, ...options.args], { stdio: 'inherit' }).catch((error) => {
    console.log(error.stderr)
    return null
  })
}
