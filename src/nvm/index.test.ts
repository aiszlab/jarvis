import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: execMock }))
const { checkoutNvm, pruneNvm, installTargetJarvis } = await import('./index.js')

let root: string
let output: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'jarvis-nvm-')))
  vi.stubEnv('NVM_DIR', root)
  vi.stubEnv('JARVIS_NVM_SHELL', '1')
  vi.stubEnv('NVM_BIN', join(root, 'versions/node/v24.0.0/bin'))
  output = vi.spyOn(console, 'error').mockImplementation(() => {})
  execMock.mockReset()
  execMock.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'ps') return `${process.pid} ${process.ppid} node\n${process.ppid} 1 zsh\n`
    if (cmd === 'lsof') throw Object.assign(new Error('no matches'), { status: 1, stdout: '', stderr: '' })
    if (cmd === 'bash') rmSync(join(root, 'versions/node', args.at(-1)!), { recursive: true })
    return ''
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
function installed(version: string) { mkdirSync(join(root, 'versions/node', version, 'bin'), { recursive: true }) }
function setup() {
  writeFileSync(join(root, 'nvm.sh'), '')
  mkdirSync(join(root, 'alias'))
  writeFileSync(join(root, 'alias/default'), 'v24.0.0\n')
  installed('v24.0.0'); installed('v20.0.0'); installed('v22.0.0')
}
describe('checkout preflight', () => {
  it('reports missing nvm before requiring shell integration', () => {
    vi.stubEnv('JARVIS_NVM_SHELL', '')
    expect(() => checkoutNvm('24')).toThrow(/install nvm/i)
  })
  it('requires shell integration and accepts numeric versions only', () => {
    setup()
    vi.stubEnv('JARVIS_NVM_SHELL', '')
    expect(() => checkoutNvm('24')).toThrow(/jrv setup/)
    vi.stubEnv('JARVIS_NVM_SHELL', '1')
    for (const version of ['24; touch BAD', '--lts', '../24', '24\n']) {
      expect(() => checkoutNvm(version)).toThrow(/numeric/)
    }
    expect(() => checkoutNvm('v24.1.0')).not.toThrow()
  })
})
describe('conservative prune', () => {
  it('keeps target and removes the previous version and only removes matching download caches', () => {
    setup()
    for (const name of ['node-v20.0.0-darwin-arm64', 'node-v20.0.01-darwin-arm64', 'node-v24.0.0-darwin-arm64']) {
      mkdirSync(join(root, '.cache/bin', name), { recursive: true })
    }
    mkdirSync(join(root, '.cache/src/node-v20.0.0'), { recursive: true })
    pruneNvm()
    expect(existsSync(join(root, 'versions/node/v20.0.0'))).toBe(false)
    expect(existsSync(join(root, 'versions/node/v22.0.0'))).toBe(false)
    expect(existsSync(join(root, 'versions/node/v24.0.0'))).toBe(true)
    expect(existsSync(join(root, '.cache/bin/node-v20.0.0-darwin-arm64'))).toBe(false)
    expect(existsSync(join(root, '.cache/src/node-v20.0.0'))).toBe(false)
    expect(existsSync(join(root, '.cache/bin/node-v20.0.01-darwin-arm64'))).toBe(true)
    expect(existsSync(join(root, '.cache/bin/node-v24.0.0-darwin-arm64'))).toBe(true)
  })
  it.each(['other shell', 'inspection error', 'open file', 'lsof unavailable', 'lsof warning', 'default changed'])('skips deletion on %s', (mode) => {
    setup()
    const normal = execMock.getMockImplementation()!
    execMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'ps' && mode === 'other shell') return `${process.pid} ${process.ppid} node\n${process.ppid} 1 zsh\n900000 1 bash\n`
      if (cmd === 'ps' && mode === 'inspection error') throw new Error('denied')
      if (cmd === 'lsof' && mode === 'open file') return 'p555\nn/node\n'
      if (cmd === 'lsof' && mode === 'lsof unavailable') throw new Error('ENOENT')
      if (cmd === 'lsof' && mode === 'lsof warning') throw Object.assign(new Error('warning'), { status: 1, stdout: '', stderr: 'permission denied' })
      if (cmd === 'lsof' && mode === 'default changed') writeFileSync(join(root, 'alias/default'), 'v20.0.0\n')
      return normal(cmd, args)
    })
    pruneNvm()
    expect(existsSync(join(root, 'versions/node/v20.0.0'))).toBe(true)
    expect(output).toHaveBeenCalled()
  })
  it('does not follow symlinked version roots', () => {
    setup()
    const outside = join(root, 'outside'); mkdirSync(outside)
    symlinkSync(outside, join(root, 'versions/node/v18.0.0'))
    pruneNvm()
    expect(existsSync(outside)).toBe(true)
    expect(execMock.mock.calls.filter(([cmd, args]) => cmd === 'bash' && args.at(-1) === 'v18.0.0')).toHaveLength(0)
  })
  it.each(['.cache', '.cache/bin', '.cache/bin/node-v20.0.0-darwin-arm64'])('never uninstalls through symlinked cache path %s', (location) => {
    setup()
    const outside = join(root, 'outside'); mkdirSync(outside)
    const link = join(root, location)
    mkdirSync(join(link, '..'), { recursive: true })
    symlinkSync(outside, link)
    pruneNvm()
    expect(existsSync(join(root, 'versions/node/v20.0.0'))).toBe(true)
    expect(existsSync(outside)).toBe(true)
  })
  it('protects a Jarvis installation reached through a symlinked NVM_DIR', () => {
    setup()
    const cli = join(root, 'versions/node/v20.0.0/bin/jrv')
    writeFileSync(cli, '')
    const link = join(root, 'linked-nvm'); symlinkSync(root, link)
    vi.stubEnv('NVM_DIR', link)
    vi.stubEnv('NVM_BIN', join(link, 'versions/node/v24.0.0/bin'))
    const originalArgv = process.argv
    try {
      process.argv = [process.execPath, cli]
      pruneNvm()
      expect(existsSync(cli)).toBe(true)
    } finally { process.argv = originalArgv }
  })
  it.each(['ash', 'mksh', 'yash', 'nu', 'elvish'])('skips cleanup for idle %s shells', (shell) => {
    setup()
    const normal = execMock.getMockImplementation()!
    execMock.mockImplementation((cmd, args) => cmd === 'ps'
      ? `${process.pid} ${process.ppid} node\n${process.ppid} 1 zsh\n900000 1 ${shell}\n`
      : normal(cmd, args))
    pruneNvm()
    expect(existsSync(join(root, 'versions/node/v20.0.0'))).toBe(true)
  })
  it('retains caches if uninstall fails', () => {
    setup()
    mkdirSync(join(root, '.cache/src/node-v20.0.0'), { recursive: true })
    const normal = execMock.getMockImplementation()!
    execMock.mockImplementation((cmd, args) => { if (cmd === 'bash') throw new Error('uninstall failed'); return normal(cmd, args) })
    expect(() => pruneNvm()).toThrow(/uninstall failed/)
    expect(existsSync(join(root, '.cache/src/node-v20.0.0'))).toBe(true)
  })
})

describe('install Jarvis in the selected Node', () => {
  function prepare() {
    setup()
    const bin = join(root, 'versions/node/v24.0.0/bin')
    writeFileSync(join(bin, 'node'), '')
    writeFileSync(join(bin, 'npm'), '')
    return bin
  }
  function installedJarvis(version: string, link = true) {
    const dir = join(root, 'versions/node/v24.0.0/lib/node_modules/@aiszlab/jarvis')
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@aiszlab/jarvis', version }))
    writeFileSync(join(dir, 'dist/index.js'), '')
    if (link) symlinkSync(join(dir, 'dist/index.js'), join(root, 'versions/node/v24.0.0/bin/jrv'))
    return join(dir, 'dist/index.js')
  }
  it('pins installation to the running Jarvis version and target Node prefix', async () => {
    const bin = prepare()
    const { default: pkg } = await import('../../package.json', { with: { type: 'json' } })
    execMock.mockImplementation((command, args) => {
      expect(command).toBe(join(bin, 'node'))
      if (args[1] === 'install') {
        expect(args).toEqual([join(bin, 'npm'), 'install', '--global', '--bin-links=true', '--prefix', join(bin, '..'), `@aiszlab/jarvis@${pkg.version}`])
        installedJarvis(pkg.version)
        return ''
      }
      expect(args.at(-1)).toBe('--version')
      return pkg.version + '\n'
    })
    expect(installTargetJarvis()).toBe(join(root, 'versions/node/v24.0.0/lib/node_modules/@aiszlab/jarvis/dist/index.js'))
  })
  it('propagates installation failure without uninstalling any Node version', () => {
    prepare()
    execMock.mockImplementation(() => { throw new Error('npm install failed') })
    expect(() => installTargetJarvis()).toThrow(/npm install failed/)
    expect(existsSync(join(root, 'versions/node/v22.0.0'))).toBe(true)
  })
  it('rejects a valid package without a working jrv command link', async () => {
    prepare()
    const { default: pkg } = await import('../../package.json', { with: { type: 'json' } })
    execMock.mockImplementation(() => { installedJarvis(pkg.version, false); return pkg.version })
    expect(() => installTargetJarvis()).toThrow(/verify Jarvis command/)
    expect(existsSync(join(root, 'versions/node/v22.0.0'))).toBe(true)
  })
  it('rejects an installation whose version does not match', () => {
    prepare()
    execMock.mockImplementation(() => { installedJarvis('0.0.0'); return '' })
    expect(() => installTargetJarvis()).toThrow(/verify Jarvis/)
  })
})
