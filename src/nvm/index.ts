import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { createFeedback, formatError } from '../cli/feedback.js'
import pkg from '../../package.json' with { type: 'json' }

const EXACT_VERSION = /^v\d+\.\d+\.\d+$/
const nvmDir = () => resolve(process.env.NVM_DIR || join(homedir(), '.nvm'))
const feedback = createFeedback()
const skip = (reason: string) => feedback.warn(`nvm cleanup skipped: ${reason}`)

/**
 * @zh 检查 nvm 与 shell 集成，不修改用户环境
 * @en validate nvm and shell integration without changing the environment
 */
export function checkoutNvm(version: string): void {
  validateNvm()
  if (!/^v?\d+(\.\d+){0,2}$/.test(version)) throw new Error('Use a numeric Node version, for example 24 or v24.1.0.')
}

function validateNvm(): void {
  if (!['darwin', 'linux'].includes(platform())) throw new Error('nvm checkout requires macOS/Linux and nvm-sh.')
  try {
    accessSync(join(nvmDir(), 'nvm.sh'), constants.R_OK)
  } catch {
    throw new Error('nvm was not found. Please install nvm-sh: https://github.com/nvm-sh/nvm#installing-and-updating ; set NVM_DIR if installed elsewhere.')
  }
  if (process.env.JARVIS_NVM_SHELL !== '1') {
    throw new Error('Shell integration is required to change the current terminal. Run jrv setup, then source the jarvis.sh line in your shell rc (or open a new terminal).')
  }
}

function directory(path: string): boolean {
  return existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()
}

function defaultVersion(root: string): string {
  const version = readFileSync(join(root, 'alias/default'), 'utf8').trim()
  if (!EXACT_VERSION.test(version)) throw new Error('default is not an exact Node version')
  return version
}

function inspectProcesses(): void {
  const listing = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const configuredShells = new Set(readFileSync('/etc/shells', 'utf8').split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('/')).map(line => basename(line)))
  let foundSelf = false
  for (const line of listing.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) throw new Error('could not parse process listing')
    const pid = Number(match[1])
    if (pid === process.pid) foundSelf = true
    const name = basename(match[3]).replace(/^-/, '')
    if (pid !== process.ppid && (/sh$/.test(name) || /^(nu|elvish|ion|oil)$/.test(name) || configuredShells.has(name))) {
      throw new Error('another shell is running; close other terminal sessions before retrying --force')
    }
  }
  if (!foundSelf) throw new Error('incomplete process listing')
}

function hasOpenFiles(path: string): boolean {
  try {
    execFileSync('lsof', ['-nP', '-F', 'pn', '+D', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch (err) {
    const result = err as { status?: number; stdout?: string; stderr?: string }
    if (result.status === 1 && String(result.stdout ?? '') === '' && String(result.stderr ?? '') === '') return false
    throw new Error('lsof unavailable or unable to inspect open files')
  }
}

function cacheMatches(name: string, version: string): boolean {
  return name === `node-${version}` || name.startsWith(`node-${version}-`)
}

function checkCachePaths(root: string, version: string): void {
  const paths = [join(root, '.cache')]
  for (const kind of ['bin', 'src']) {
    const parent = join(root, '.cache', kind)
    paths.push(parent)
  }
  for (const path of paths) {
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('unsafe nvm cache directory')
  }
  for (const parent of paths.slice(1)) {
    if (!directory(parent)) continue
    for (const name of readdirSync(parent)) {
      if (cacheMatches(name, version) && !directory(join(parent, name))) throw new Error('unsafe nvm cache entry')
    }
  }
}

function removeVersionCache(root: string, version: string): void {
  if (!directory(join(root, '.cache'))) return
  for (const kind of ['bin', 'src']) {
    const parent = join(root, '.cache', kind)
    if (!directory(parent)) continue
    for (const name of readdirSync(parent)) {
      if (!cacheMatches(name, version)) continue
      const path = join(parent, name)
      if (directory(path)) rmSync(path, { recursive: true })
    }
  }
}

/**
 * @zh 成功切换后保守清理旧版本；检测失败时保留文件
 * @en conservatively prune old versions after checkout; retain files when inspection fails
 */
export function pruneNvm(): void {
  validateNvm()
  const root = nvmDir()
  const target = defaultVersion(root)
  const versions = join(root, 'versions/node')
  if (!directory(join(root, 'versions')) || !directory(versions)) { skip('unsafe versions directory'); return }
  if (resolve(process.env.NVM_BIN || '.') !== join(versions, target, 'bin')) { skip('current shell does not use default'); return }
  const protectedPaths = [realpathSync(process.execPath)]
  if (process.argv[1] && existsSync(process.argv[1])) protectedPaths.push(realpathSync(process.argv[1]))
  let removed = 0
  let retained = 0
  let skipped = 0
  for (const version of readdirSync(versions)) {
    const path = join(versions, version)
    if (!EXACT_VERSION.test(version) || !directory(path)) continue
    if (version === target || protectedPaths.some(p => p.startsWith(realpathSync(path) + sep))) {
      retained++
      feedback.info(`nvm cleanup retained ${version}: default or active Jarvis installation/runtime`)
      continue
    }
    try {
      checkCachePaths(root, version)
      inspectProcesses()
      if (hasOpenFiles(path)) { skipped++; skip(`${version} has open files`); continue }
      inspectProcesses()
      if (defaultVersion(root) !== target) { skip('default changed concurrently'); return }
    } catch (err) {
      skip(formatError(err))
      return
    }
    feedback.info(`Removing ${version} and its global packages and nvm download cache`)
    execFileSync('bash', ['-c', '. "$1" --no-use && nvm use "$2" && nvm uninstall "$3"', 'jarvis-nvm', join(root, 'nvm.sh'), target, version], {
      env: { ...process.env, NVM_DIR: root }, stdio: ['inherit', 2, 2],
    })
    if (existsSync(path)) throw new Error(`nvm uninstall did not remove ${version}; caches retained`)
    removeVersionCache(root, version)
    removed++
  }
  feedback.summary('nvm cleanup complete', { Removed: String(removed), Retained: String(retained), Skipped: String(skipped) })
}

/**
 * @zh 在目标 Node 下安装当前版本 Jarvis，验证成功后返回新入口
 * @en install the current Jarvis release under the target Node and return its verified entry
 */
export function installTargetJarvis(): string {
  validateNvm()
  const root = nvmDir()
  const target = defaultVersion(root)
  const prefix = join(root, 'versions/node', target)
  const bin = join(prefix, 'bin')
  if (resolve(process.env.NVM_BIN || '.') !== bin) throw new Error('Target Node is not active; old versions retained.')
  const node = join(bin, 'node')
  if (!realpathSync(node).startsWith(realpathSync(prefix) + sep)) throw new Error('Target Node executable is outside its installation.')
  execFileSync(node, [join(bin, 'npm'), 'install', '--global', '--bin-links=true', '--prefix', join(bin, '..'), `${pkg.name}@${pkg.version}`], {
    env: process.env, stdio: ['inherit', 2, 2],
  })
  const installed = join(prefix, 'lib/node_modules/@aiszlab/jarvis')
  const metadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  const entry = realpathSync(join(installed, 'dist/index.js'))
  if (metadata.name !== pkg.name || metadata.version !== pkg.version ||
      !entry.startsWith(realpathSync(prefix) + sep) || /[\r\n]/.test(entry)) {
    throw new Error('Unable to verify Jarvis installation; old Node versions retained.')
  }
  if (!existsSync(join(bin, 'jrv')) || realpathSync(join(bin, 'jrv')) !== entry) {
    throw new Error('Unable to verify Jarvis command link; old Node versions retained.')
  }
  const version = execFileSync(node, [entry, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (version !== pkg.version) throw new Error('Unable to verify Jarvis executable; old Node versions retained.')
  return entry
}
