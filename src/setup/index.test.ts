import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { checkboxMock, spawnMock, existsMock, writeMock, appendMock, readMock, mkdirMock } = vi.hoisted(() => ({
  checkboxMock: vi.fn(), spawnMock: vi.fn(), existsMock: vi.fn(),
  writeMock: vi.fn(), appendMock: vi.fn(), readMock: vi.fn(), mkdirMock: vi.fn()
}))
vi.mock('@inquirer/prompts', () => ({ checkbox: checkboxMock }))
vi.mock('@npmcli/promise-spawn', () => ({ default: spawnMock }))
vi.mock('node:fs', () => ({
  existsSync: existsMock, writeFileSync: writeMock, appendFileSync: appendMock,
  readFileSync: readMock, mkdirSync: mkdirMock
}))
vi.mock('node:os', () => ({ homedir: () => '/home/test' }))
const { setupDev } = await import('./index.js')

function expectNoChanges() {
  expect(spawnMock).not.toHaveBeenCalled()
  expect(existsMock).not.toHaveBeenCalled()
  expect(writeMock).not.toHaveBeenCalled()
  expect(appendMock).not.toHaveBeenCalled()
  expect(mkdirMock).not.toHaveBeenCalled()
}

describe('selective setup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('SHELL', '/bin/zsh')
    checkboxMock.mockResolvedValue([])
    existsMock.mockReturnValue(false)
    spawnMock.mockImplementation(async (command: string) => {
      if (command === 'which' || command === 'git') throw new Error('not found')
      return {}
    })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

  it('offers four unchecked choices and makes no changes for empty selection', async () => {
    await setupDev()
    const choices = checkboxMock.mock.calls[0][0].choices
    expect(choices.map((choice: { value: string }) => choice.value)).toEqual(['pnpm', 'claude', 'config', 'shell'])
    expect(choices.every((choice: { checked?: boolean }) => !choice.checked)).toBe(true)
    expectNoChanges()
  })

  it.each(['ExitPromptError', 'AbortPromptError'])('cancels without changes on %s', async (name) => {
    checkboxMock.mockRejectedValue(Object.assign(new Error('cancelled'), { name }))
    await expect(setupDev()).resolves.toBeUndefined()
    expectNoChanges()
  })

  it('propagates unexpected prompt errors without changes', async () => {
    const error = new Error('prompt failed')
    checkboxMock.mockRejectedValue(error)
    await expect(setupDev()).rejects.toBe(error)
    expectNoChanges()
  })

  it.each([['pnpm', 'pnpm', 'pnpm'], ['claude', 'claude', '@anthropic-ai/claude-code']])(
    'installs only selected %s', async (choice, command, pkg) => {
      checkboxMock.mockResolvedValue([choice])
      await setupDev()
      expect(spawnMock.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
        ['which', [command]], ['npm', ['install', '-g', pkg]]
      ])
      expect(existsMock).not.toHaveBeenCalled()
      expect(appendMock).not.toHaveBeenCalled()
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('to activate'))
    }
  )

  it.each(['pnpm', 'claude'])('skips already installed %s', async (choice) => {
    checkboxMock.mockResolvedValue([choice])
    spawnMock.mockResolvedValue({})
    await setupDev()
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith('which', [choice], expect.anything())
  })

  it('initializes only project config and gitignore', async () => {
    checkboxMock.mockResolvedValue(['config'])
    existsMock.mockImplementation((path: string) => path === `${process.cwd()}/.git`)
    await setupDev()
    expect(writeMock).toHaveBeenCalledWith(`${process.cwd()}/.jarvis/settings.json`, '{\n  "env": {}\n}\n')
    expect(writeMock).toHaveBeenCalledWith(`${process.cwd()}/.gitignore`, expect.stringContaining('.jarvis/'))
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0][0]).toBe('git')
    expect(appendMock).not.toHaveBeenCalled()
  })

  it('preserves existing config', async () => {
    checkboxMock.mockResolvedValue(['config'])
    existsMock.mockImplementation((path: string) => path.endsWith('/.jarvis/settings.json'))
    await setupDev()
    expect(writeMock).not.toHaveBeenCalled()
    expect(mkdirMock).not.toHaveBeenCalled()
  })

  it.each([['/bin/bash', '.bashrc'], ['/bin/zsh', '.zshrc']])('installs only shell integration for %s', async (shell, rc) => {
    vi.stubEnv('SHELL', shell)
    checkboxMock.mockResolvedValue(['shell'])
    await setupDev()
    expect(appendMock).toHaveBeenCalledWith(`/home/test/${rc}`, expect.stringContaining('jarvis.sh'))
    expect(console.log).toHaveBeenCalledWith(`\nto activate, run: source "/home/test/${rc}"`)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('does not duplicate existing shell integration', async () => {
    checkboxMock.mockResolvedValue(['shell'])
    existsMock.mockReturnValue(true)
    readMock.mockReturnValue('source jarvis.sh')
    await setupDev()
    expect(appendMock).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('runs all four selected operations', async () => {
    checkboxMock.mockResolvedValue(['pnpm', 'claude', 'config', 'shell'])
    await setupDev()
    expect(spawnMock).toHaveBeenCalledWith('npm', ['install', '-g', 'pnpm'], expect.anything())
    expect(spawnMock).toHaveBeenCalledWith('npm', ['install', '-g', '@anthropic-ai/claude-code'], expect.anything())
    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining('.jarvis/settings.json'), expect.any(String))
    expect(appendMock).toHaveBeenCalledWith('/home/test/.zshrc', expect.stringContaining('jarvis.sh'))
  })

  it('stops on installation failure before later selected changes', async () => {
    const error = new Error('install failed')
    checkboxMock.mockResolvedValue(['pnpm', 'config', 'shell'])
    spawnMock.mockRejectedValue(error)
    await expect(setupDev()).rejects.toBe(error)
    expect(writeMock).not.toHaveBeenCalled()
    expect(appendMock).not.toHaveBeenCalled()
  })
})
