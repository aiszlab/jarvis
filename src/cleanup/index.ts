import { checkbox, confirm, Separator } from '@inquirer/prompts'
import { globSync } from 'glob'
import spawn from '@npmcli/promise-spawn'
import { rimraf } from 'rimraf'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

/**
 * @zh 清理目标的风险等级：safe 为纯缓存、删除后自动重建；
 * moderate 可能影响正在运行的应用（整目录的用户缓存/日志）；
 * risky 会删除用户数据，默认不参与扫描，需 `--risky` 显式开启
 * @en risk tier of a cleanup target: safe targets are pure caches that rebuild
 * themselves; moderate targets may disturb running apps (whole-dir user caches
 * / logs); risky targets delete user data, are excluded from scans by default
 * and require `--risky` to be included
 */
export type CleanupTier = 'safe' | 'moderate' | 'risky'

/**
 * @zh 一个可清理的目标。`tier` 为风险等级；`path` 可用 `~/` 开头，扫描时展开；
 * `alternatePaths` 为备选路径（如 Yarn 缓存的大小写变体），主路径优先；
 * `deleteChildren` 为 true 时只删目录内容、保留目录本身；
 * `keepChildren` 与 `deleteChildren` 搭配，按目录名保留子项
 * （如 Node 版本自带的 npm / corepack）
 * @en a cleanable target. `tier` is its risk level; `path` may start with `~/`
 * and is expanded at scan time; `alternatePaths` are fallback candidates (e.g.
 * Yarn case variants) with the primary path preferred; when `deleteChildren`
 * is true only the directory contents are removed and the directory itself is
 * kept; `keepChildren` pairs with `deleteChildren` to preserve children by
 * name (e.g. the npm / corepack bundled with a Node version)
 */
export interface CleanupTarget {
  id: string
  labelZh: string
  labelEn: string
  tier: CleanupTier
  path: string
  deleteChildren?: boolean
  keepChildren?: string[]
  alternatePaths?: string[]
}

/**
 * @zh 静态清理清单，按风险分级排序：safe（自动重建的缓存）→
 * moderate（整目录缓存/日志）→ risky（用户数据，默认隐藏）。
 * 需要新增目标时在这里加一行即可
 * @en static cleanup manifest ordered by risk tier: safe (auto-regenerated
 * caches) → moderate (whole-dir caches / logs) → risky (user data, hidden by
 * default). add a line here to register a new target
 */
export const CLEANUP_TARGETS: CleanupTarget[] = [
  // safe — auto-regenerated caches
  {
    id: 'npm-cache',
    labelZh: 'npm 缓存',
    labelEn: 'npm Cache',
    tier: 'safe',
    path: '~/.npm/_cacache',
    deleteChildren: true
  },
  {
    id: 'pnpm-cache',
    labelZh: 'pnpm 缓存',
    labelEn: 'pnpm Cache',
    tier: 'safe',
    path: '~/Library/Caches/pnpm'
  },
  {
    id: 'yarn-cache',
    labelZh: 'Yarn 缓存',
    labelEn: 'Yarn Cache',
    tier: 'safe',
    path: '~/Library/Caches/Yarn',
    alternatePaths: ['~/Library/Caches/yarn']
  },
  {
    id: 'homebrew-cache',
    labelZh: 'Homebrew 缓存',
    labelEn: 'Homebrew Cache',
    tier: 'safe',
    path: '~/Library/Caches/Homebrew'
  },
  {
    id: 'pip-cache',
    labelZh: 'pip 缓存',
    labelEn: 'pip Cache',
    tier: 'safe',
    path: '~/Library/Caches/pip'
  },
  {
    id: 'xcode-derived-data',
    labelZh: 'Xcode DerivedData',
    labelEn: 'Xcode DerivedData',
    tier: 'safe',
    path: '~/Library/Developer/Xcode/DerivedData',
    deleteChildren: true
  },
  {
    id: 'trash',
    labelZh: '废纸篓',
    labelEn: 'Trash',
    tier: 'safe',
    path: '~/.Trash',
    deleteChildren: true
  },
  // moderate — whole-dir caches / logs of running apps
  {
    id: 'user-caches',
    labelZh: '用户缓存',
    labelEn: 'User Caches',
    tier: 'moderate',
    path: '~/Library/Caches',
    deleteChildren: true
  },
  {
    id: 'user-logs',
    labelZh: '用户日志',
    labelEn: 'User Logs',
    tier: 'moderate',
    path: '~/Library/Logs',
    deleteChildren: true
  },
  // risky — user data, hidden unless --risky
  {
    id: 'core-simulator-devices',
    labelZh: 'iOS 模拟器数据',
    labelEn: 'CoreSimulator Devices',
    tier: 'risky',
    path: '~/Library/Developer/CoreSimulator/Devices',
    deleteChildren: true
  }
]

const TIER_ORDER: CleanupTier[] = ['safe', 'moderate', 'risky']

const TIER_LABEL: Record<CleanupTier, string> = {
  safe: 'Safe',
  moderate: 'Moderate',
  risky: 'Risky'
}

/**
 * @zh 将 `~` 或 `~/` 开头的路径展开为用户目录下的绝对路径
 * @en expand `~` or `~/`-prefixed paths to absolute paths under home
 */
export function expandHome(path: string, home: string = os.homedir()): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

/**
 * @zh 扫描清单，返回实际存在的目标（主路径优先，备选路径兜底），
 * `path` 已展开为绝对路径；risky 级目标仅当 `includeRisky` 为 true 时返回
 * @en scan the target list and return the entries that actually exist
 * (primary path preferred, alternates as fallback), with `path` expanded to
 * an absolute path; risky-tier targets are returned only when `includeRisky`
 * is true
 */
export function scanTargets(
  home: string = os.homedir(),
  includeRisky: boolean = false
): CleanupTarget[] {
  const found: CleanupTarget[] = []
  for (const target of CLEANUP_TARGETS) {
    if (!includeRisky && target.tier === 'risky') continue
    const candidates = [target.path, ...(target.alternatePaths ?? [])]
    const resolved = candidates.map((p) => expandHome(p, home)).find((p) => existsSync(p))
    if (resolved) found.push({ ...target, path: resolved })
  }
  return found
}

/**
 * @zh 主目录下扫描 node_modules 时跳过的顶层目录名（点目录天然被跳过）：
 * Library（应用数据/TCC 保护）、Applications（自带打包依赖的应用）、
 * homebrew（Cellar 内的包依赖）
 * @en top-level directory names skipped when scanning the home directory for
 * node_modules (dot-directories are always skipped): Library (app data /
 * TCC-protected), Applications (apps with bundled deps), homebrew (Cellar
 * package deps)
 */
const NODE_MODULES_EXCLUDES = ['Library', 'Applications', 'homebrew']

/**
 * @zh 自 root 递归查找 node_modules 目录（npm 的 glob 包）：
 * 点目录默认不参与匹配、符号链接不跟随；
 * ignore 只排除 node_modules 的内容——必须用 `*` 而非 `**`，
 * minimatch 中 `a/**` 会连 `a` 本身一起匹配、把结果误删；
 * root 直属的排除目录通过相对 cwd 的 `${name}/**` 锚定在顶层；
 * 结果再经 lstat 过滤，剔除同名普通文件与符号链接
 * @en recursively find node_modules directories under root (the glob
 * package): dot-directories never match and symlinks are not followed;
 * the ignore list prunes only node_modules CONTENTS — `*` is required
 * because in minimatch `a/**` matches `a` itself and would wipe the
 * results; excluded top-level names are anchored to the top level via
 * cwd-relative `${name}/**` patterns; results get one lstat pass to drop
 * same-named files and symlinks
 */
export function findNodeModules(
  root: string,
  excludes: string[] = NODE_MODULES_EXCLUDES
): string[] {
  const ignore = [
    '**/node_modules/*',
    '**/node_modules/*/**',
    ...excludes.map((name) => `${name}/**`)
  ]
  return globSync('**/node_modules', { cwd: root, ignore, follow: false })
    .map((path) => join(root, path))
    .filter((path) => {
      let stat
      try {
        stat = lstatSync(path)
      } catch {
        return false
      }
      return stat.isDirectory() && !stat.isSymbolicLink()
    })
}

/**
 * @zh 包管理器与 Node 版本管理器全局安装的 node_modules 清单
 * （路径段内支持单个 `*` 通配）：nvm / asdf / fnm / volta 每个 Node 版本
 * 存一份，pnpm 按 store 版本存放（中间一段不定），npm / Yarn 全局目录固定。
 * 版本管理器目录里自带 npm / corepack（Node 16.9+），清理时保留
 * （`keepChildren`），只删用户全局安装的包
 * @en manifest of package-manager and Node-version-manager global
 * node_modules (a single `*` wildcard per segment is supported): nvm / asdf
 * / fnm / volta keep one copy per Node version, pnpm nests under its store
 * version (a varying middle segment), npm / Yarn global dirs are fixed.
 * Version-manager dirs bundle npm / corepack (Node 16.9+), which are kept
 * during cleanup (`keepChildren`) while only user-installed global packages
 * are removed
 */
const GLOBAL_NODE_MODULES_GLOBS: Array<{ pattern: string; keepChildren?: string[] }> = [
  // Node version managers — one global node_modules per installed version
  { pattern: '~/.nvm/versions/node/*/lib/node_modules', keepChildren: ['npm', 'corepack'] },
  { pattern: '~/.asdf/installs/nodejs/*/lib/node_modules', keepChildren: ['npm', 'corepack'] },
  { pattern: '~/Library/Application Support/fnm/node-versions/*/installation/lib/node_modules', keepChildren: ['npm', 'corepack'] },
  { pattern: '~/.volta/tools/image/node/*/lib/node_modules', keepChildren: ['npm', 'corepack'] },
  // package managers — npm / pnpm / Yarn global install roots
  { pattern: '~/.npm-global/lib/node_modules' },
  { pattern: '~/Library/pnpm/global/*/node_modules' },
  { pattern: '~/.local/share/pnpm/global/*/node_modules' },
  { pattern: '~/.config/yarn/global/node_modules' }
]

/**
 * @zh 用第三方 `glob` 包的 `globSync` 展开含单段 `*` 通配的路径：
 * 点目录天然不参与 `*` 匹配，中间目录不存在时返回空；
 * 结果为符号链接的条目跳过——它只是别名，删除只断链接、不释放空间，
 * 其真实目标（如 `~/.nvm/current` 指向的版本目录）会作为实体目录
 * 被单独扫到，跳过可避免重复统计
 * @en expand a path containing single-segment `*` wildcards with the
 * the `glob` package's `globSync`: dot-directories never match `*` and missing
 * intermediate directories yield nothing; symlink results are skipped —
 * a link is only an alias, removing it frees nothing, and its real target
 * (e.g. the version dir behind `~/.nvm/current`) is scanned on its own, so
 * skipping avoids double counting
 */
function expandGlob(pattern: string, home: string): string[] {
  return globSync(expandHome(pattern, home), { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * @zh 扫描各包管理器 / Node 版本管理器全局安装的 node_modules
 * （nvm、asdf、fnm、volta 每个 Node 版本一份，pnpm 按 store 版本存放，
 * npm / Yarn 全局目录固定），返回存在的目录（按路径去重）；
 * 版本管理器目录附带的 `keepChildren` 为清理时需保留的自带包
 * （npm / corepack）
 * @en scan for globally installed node_modules of package managers and Node
 * version managers (nvm, asdf, fnm, volta keep one per version, pnpm nests
 * per store version, npm / Yarn global dirs are fixed), returning existing
 * directories deduplicated by path; `keepChildren` on version-manager dirs
 * names the bundled packages (npm / corepack) to preserve during cleanup
 */
export function findGlobalNodeModules(
  home: string = os.homedir()
): Array<{ path: string; keepChildren?: string[] }> {
  const found: Array<{ path: string; keepChildren?: string[] }> = []
  for (const entry of GLOBAL_NODE_MODULES_GLOBS) {
    for (const path of expandGlob(entry.pattern, home)) {
      found.push({ path, ...(entry.keepChildren ? { keepChildren: entry.keepChildren } : {}) })
    }
  }
  return found.filter((item, index, all) => all.findIndex((x) => x.path === item.path) === index)
}

/**
 * @zh 将 KiB 格式化为人类可读大小（自动换算 KB/MB/GB/TB）
 * @en format a KiB value as a human-readable size (auto-scales KB/MB/GB/TB)
 */
export function formatSize(kib: number): string {
  if (kib < 1024) return `${kib} KB`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = kib
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const decimals = value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toFixed(decimals)} ${units[unit]}`
}

/**
 * @zh 用 `du -sk` 测量目录占用（KiB）。
 * macOS 的 du 遇到无权限子目录（如 TCC 保护的缓存）时退出码非 0，
 * 但 stdout 仍有部分统计——此时照常解析；仅当无法解析时才抛错
 * @en measure a path's usage in KiB via `du -sk`.
 * macOS du exits non-zero when subdirectories are unreadable (e.g.
 * TCC-protected caches) but still prints a partial total on stdout —
 * parse it anyway; only throw when nothing is parseable
 */
export async function measureSize(path: string): Promise<number> {
  let stdout: string
  let failure: unknown
  try {
    ;({ stdout } = await spawn('du', ['-sk', path], { stdio: 'pipe' }))
  } catch (err) {
    failure = err
    stdout = (err as { stdout?: string }).stdout ?? ''
  }
  const match = stdout.match(/^\s*(\d+)/)
  if (match) return Number(match[1])
  if (failure) {
    const { stderr, message } = failure as { stderr?: string; message?: string }
    const detail = stderr?.trim().split('\n')[0] || message || 'command failed'
    throw new Error(`du -sk ${path} failed: ${detail}`)
  }
  throw new Error(`unexpected du output: ${stdout}`)
}

/**
 * @zh 测量一个目录下除 `keep` 名单外所有子项的合计占用（KiB）：
 * 一次 `du -sk` 传入全部子项、逐行解析求和；全部被保留时返回 0；
 * du 部分失败时照常解析能解析的行，仅当完全无法解析时才抛错
 * @en measure the combined usage (KiB) of every child of a directory except
 * those named in `keep`: one `du -sk` call with all children, summing the
 * per-line totals; returns 0 when every child is kept; a partially failing du
 * still parses the parseable lines, throwing only when nothing is parseable
 */
export async function measureChildrenSize(path: string, keep: string[] = []): Promise<number> {
  const args = readdirSync(path)
    .filter((name) => !keep.includes(name))
    .map((name) => join(path, name))
  if (args.length === 0) return 0
  let stdout: string
  let failure: unknown
  try {
    ;({ stdout } = await spawn('du', ['-sk', ...args], { stdio: 'pipe' }))
  } catch (err) {
    failure = err
    stdout = (err as { stdout?: string }).stdout ?? ''
  }
  const sizes = stdout
    .split('\n')
    .map((line) => Number(line.match(/^\s*(\d+)/)?.[1]))
    .filter((n) => Number.isFinite(n))
  if (sizes.length > 0) return sizes.reduce((sum, n) => sum + n, 0)
  if (failure) {
    const { stderr, message } = failure as { stderr?: string; message?: string }
    const detail = stderr?.trim().split('\n')[0] || message || 'command failed'
    throw new Error(`du -sk ${path} failed: ${detail}`)
  }
  throw new Error(`unexpected du output: ${stdout}`)
}

type MeasuredTarget = CleanupTarget & { sizeKib: number }

/**
 * @zh 按 tier 分组生成 checkbox 选项：safe 项名称不带前缀，moderate / risky
 * 项带 `[moderate]` / `[risky]` 前缀，组间以 Separator 分隔
 * @en build checkbox choices grouped by tier: safe names carry no prefix while
 * moderate / risky names are prefixed with `[moderate]` / `[risky]`, groups
 * separated by Separators
 */
function toChoices(items: MeasuredTarget[]): Array<Separator | { value: string; name: string }> {
  const choices: Array<Separator | { value: string; name: string }> = []
  for (const tier of TIER_ORDER) {
    const tierItems = items.filter((item) => item.tier === tier)
    if (tierItems.length === 0) continue
    choices.push(new Separator(`--- ${TIER_LABEL[tier]} ---`))
    const nameWidth = Math.max(...tierItems.map((item) => item.labelEn.length))
    for (const item of tierItems) {
      const prefix = tier === 'safe' ? '' : `[${tier}] `
      choices.push({
        value: item.id,
        name: `${prefix}${item.labelEn.padEnd(nameWidth)} │ ${formatSize(item.sizeKib)}`
      })
    }
  }
  return choices
}

/**
 * @zh 删除一个目标：`deleteChildren` 模式逐子项删除（含点文件），
 * `keepChildren` 名单中的子项（如 Node 自带的 npm）跳过不动，
 * 单个子项失败（如 TCC 保护）仅警告并继续其余子项；
 * 否则删除目录本身，失败向上抛
 * @en delete a target: children mode removes each child (dotfiles included)
 * except those named in `keepChildren` (e.g. the npm bundled with Node),
 * warning and continuing when a single child fails (e.g. TCC-protected);
 * otherwise removes the directory itself, letting failures propagate
 */
async function deleteTarget(target: CleanupTarget): Promise<void> {
  if (target.deleteChildren) {
    for (const name of readdirSync(target.path)) {
      if (target.keepChildren?.includes(name)) continue
      const child = join(target.path, name)
      try {
        await rimraf(child)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`failed to clean ${child}: ${message}`)
      }
    }
  } else {
    await rimraf(target.path)
  }
}

export interface CleanupOptions {
  /** @zh 只预览大小不删除 @en preview sizes without deleting */
  dryRun?: boolean
  /** @zh 跳过提示清理全部检测到的目标（不含 risky） @en clean all detected targets without prompting (risky excluded) */
  yes?: boolean
  /** @zh 将 risky 级目标纳入扫描与清理 @en include risky-tier targets in the scan and cleanup */
  risky?: boolean
}

/**
 * @zh 清理 Mac 上的垃圾文件（包管理器缓存、Xcode DerivedData、废纸篓、
 * 用户缓存/日志等，主目录下各项目的 node_modules，以及 nvm / pnpm /
 * Yarn 等包管理器与 Node 版本管理器全局安装的 node_modules，
 * 版本管理器目录中 Node 自带的 npm / corepack 会保留），
 * 按 safe / moderate / risky 三级分级：
 * 扫描并显示大小 → 交互式多选 → 确认 → 永久删除。
 * `-d/--dry-run` 仅预览不删除；`-y/--yes` 跳过提示清理全部检测到的
 * 目标（不含 risky）；`-r/--risky` 将 risky 级目标纳入；`-d` 与 `-y`
 * 同时给定时 dry-run 优先
 * @en clean junk files on macOS (package manager caches, Xcode DerivedData,
 * trash, user caches / logs, ..., every project node_modules under the home
 * directory, plus node_modules globally installed by npm / pnpm / Yarn and
 * Node version managers such as nvm — the npm / corepack bundled with each
 * Node version are kept) in safe / moderate / risky tiers:
 * scan and show sizes → interactive multi-select → confirm → permanently
 * delete. `-d/--dry-run` previews without deleting; `-y/--yes` cleans all
 * detected targets (risky excluded) without prompting; `-r/--risky` includes
 * risky-tier targets; dry run wins when `-d` and `-y` are both set
 *
 * usage: `jrv cleanup` or `jrv cleanup -d` (macOS only)
 */
export async function cleanup(options: CleanupOptions = {}): Promise<void> {
  if (os.platform() !== 'darwin') {
    console.error('cleanup only works on macOS')
    process.exit(1)
  }

  const home = os.homedir()
  const allStatic = scanTargets(home, true)
  const staticTargets = options.risky
    ? allStatic
    : allStatic.filter((target) => target.tier !== 'risky')

  const measured: MeasuredTarget[] = []
  for (const target of staticTargets) {
    try {
      measured.push({ ...target, sizeKib: await measureSize(target.path) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`skipping ${target.labelEn}: failed to measure size (${message})`)
    }
  }

  console.log('scanning for cleanup targets...')
  const nodeModuleTargets: CleanupTarget[] = [
    ...findNodeModules(home).map((path): CleanupTarget => {
      const project = path.slice(home.length + 1).replace(/\/node_modules$/, '')
      const label = project ? `node_modules (~/${project})` : 'node_modules (~)'
      return {
        id: path,
        labelZh: label,
        labelEn: label,
        tier: 'moderate',
        path,
        deleteChildren: false
      }
    }),
    ...findGlobalNodeModules(home).map(({ path, keepChildren }): CleanupTarget => {
      const parent = path.slice(home.length + 1).replace(/\/node_modules$/, '')
      const suffix = keepChildren ? '，保留 npm/corepack' : ''
      const suffixEn = keepChildren ? ', npm/corepack kept' : ''
      return {
        id: path,
        labelZh: `全局 node_modules (~/${parent}${suffix})`,
        labelEn: `global node_modules (~/${parent}${suffixEn})`,
        tier: 'moderate',
        path,
        deleteChildren: keepChildren ? true : false,
        keepChildren
      }
    })
  ]
  const nodeModules: MeasuredTarget[] = []
  for (const target of nodeModuleTargets) {
    try {
      const sizeKib = target.keepChildren
        ? await measureChildrenSize(target.path, target.keepChildren)
        : await measureSize(target.path)
      // 版本管理器目录里除 npm/corepack 外无可删内容时跳过该项
      if (sizeKib === 0) continue
      nodeModules.push({ ...target, sizeKib })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`skipping ${target.labelEn}: failed to measure size (${message})`)
    }
  }
  nodeModules.sort((a, b) => b.sizeKib - a.sizeKib)
  measured.push(...nodeModules)

  if (measured.length === 0) {
    if (allStatic.length === 0) {
      console.log('✓ nothing to clean up — no cleanup targets detected')
    } else if (staticTargets.length === 0) {
      console.log('✓ only risky targets detected — rerun with --risky to include them')
    } else {
      console.log('✓ nothing to clean up')
    }
    return
  }

  if (options.dryRun) {
    for (const tier of TIER_ORDER) {
      const tierItems = measured.filter((item) => item.tier === tier)
      if (tierItems.length === 0) continue
      console.log(`${TIER_LABEL[tier]}:`)
      for (const item of tierItems) {
        console.log(`  ${item.labelEn} — ${formatSize(item.sizeKib)}`)
      }
    }
    const totalKib = measured.reduce((sum, item) => sum + item.sizeKib, 0)
    console.log(`Total Reclaimable: ${formatSize(totalKib)} in ${measured.length} items`)
    return
  }

  let selected: string[]
  if (options.yes) {
    selected = measured.map((item) => item.id)
  } else {
    const totalKib = measured.reduce((sum, item) => sum + item.sizeKib, 0)
    console.log(`Total Reclaimable: ${formatSize(totalKib)} in ${measured.length} items`)
    try {
      selected = await checkbox<string>({
        message: 'Select items to clean up',
        choices: toChoices(measured)
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'ExitPromptError') return
      throw err
    }
  }

  if (selected.length === 0) return

  if (!options.yes) {
    const selectedItems = measured.filter((item) => selected.includes(item.id))
    const totalKib = selectedItems.reduce((sum, item) => sum + item.sizeKib, 0)
    const ok = await confirm({
      message: `clean ${selectedItems.length} items, ${formatSize(totalKib)} total? This permanently deletes files.`
    })
    if (!ok) return
  }

  let cleaned = 0
  let freedKib = 0
  for (const item of measured) {
    if (!selected.includes(item.id)) continue
    try {
      await deleteTarget(item)
      cleaned++
      freedKib += item.sizeKib
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`failed to clean ${item.labelEn}: ${message}`)
    }
  }

  console.log(`✓ cleaned ${cleaned} items, freed ${formatSize(freedKib)}`)
}
