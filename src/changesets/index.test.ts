import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, resolveMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolveMock: vi.fn()
}))

vi.mock('@npmcli/promise-spawn', () => ({
  default: spawnMock
}))

vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('module')>()

  return {
    ...actual,
    createRequire: () => ({ resolve: resolveMock })
  }
})

import { add } from './index.js'

describe('changesets', () => {
  beforeEach(() => {
    resolveMock.mockReset().mockReturnValue('/project/node_modules/@changesets/cli/bin.js')
    spawnMock.mockReset().mockResolvedValue({})
  })

  it('starts the native interactive changesets CLI without arguments by default', async () => {
    await add({})

    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['/project/node_modules/@changesets/cli/bin.js'],
      { stdio: 'inherit' }
    )
  })

  it('forwards a changesets subcommand', async () => {
    await add({ command: 'version' })

    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['/project/node_modules/@changesets/cli/bin.js', 'version'],
      { stdio: 'inherit' }
    )
  })

  it('runs the version subcommand when the version option is enabled', async () => {
    await add({ options: { version: true } })

    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['/project/node_modules/@changesets/cli/bin.js', 'version'],
      { stdio: 'inherit' }
    )
  })
})
