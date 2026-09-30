import { checkbox, confirm } from '@inquirer/prompts'
import spawn from '@npmcli/promise-spawn'
import { rimraf } from 'rimraf'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

/**
 * @zh 一个可安全清理的目标。`path` 可用 `~/` 开头，扫描时展开；
 * `alternatePaths` 为备选路径（如 Yarn 缓存的大小写变体），主路径优先；
 * `deleteChildren` 为 true 时只删目录内容、保留目录本身
 * @en a safe-to-clean target. `path` may start with `~/` and is expanded at
 * scan time; `alternatePaths` are fallback candidates (e.g. Yarn case
 * variants) with the primary path preferred; when `deleteChildren` is true
 * only the directory contents are removed and the directory itself is kept.
 */
export interface CleanupTarget {
  id: string
  labelZh: string
  labelEn: string
  path: string
  deleteChildren?: boolean
  alternatePaths?: string[]
}

/**
 * @zh 仅含安全级（自动重建）目标的静态清单。
 * 需要新增目标时在这里加一行即可（保持低风险：缓存/日志/废纸篓类）
 * @en static list of safe-tier (auto-regenerated) targets only.
 * add a line here to register a new target (keep it low-risk:
 * cache/log/trash-like paths)
 */
export const CLEANUP_TARGETS: CleanupTarget[] = [
  {
    id: 'user-caches',
    labelZh: '用户缓存',
    labelEn: 'User Caches',
    path: '~/Library/Caches',
    deleteChildren: true
  },
  {
    id: 'user-logs',
    labelZh: '用户日志',
    labelEn: 'User Logs',
    path: '~/Library/Logs',
    deleteChildren: true
  },
  {
    id: 'npm-cache',
    labelZh: 'npm 缓存',
    labelEn: 'npm Cache',
    path: '~/.npm/_cacache',
    deleteChildren: true
  },
  {
    id: 'pnpm-cache',
    labelZh: 'pnpm 缓存',
    labelEn: 'pnpm Cache',
    path: '~/Library/Caches/pnpm'
  },
  {
    id: 'yarn-cache',
    labelZh: 'Yarn 缓存',
    labelEn: 'Yarn Cache',
    path: '~/Library/Caches/Yarn',
    alternatePaths: ['~/Library/Caches/yarn']
  },
  {
    id: 'homebrew-cache',
    labelZh: 'Homebrew 缓存',
    labelEn: 'Homebrew Cache',
    path: '~/Library/Caches/Homebrew'
  },
  {
    id: 'pip-cache',
    labelZh: 'pip 缓存',
    labelEn: 'pip Cache',
    path: '~/Library/Caches/pip'
  },
  {
    id: 'xcode-derived-data',
    labelZh: 'Xcode DerivedData',
    labelEn: 'Xcode DerivedData',
    path: '~/Library/Developer/Xcode/DerivedData',
    deleteChildren: true
  },
  {
    id: 'trash',
    labelZh: '废纸篓',
    labelEn: 'Trash',
    path: '~/.Trash',
    deleteChildren: true
  }
]

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
 * `path` 已展开为绝对路径
 * @en scan the target list and return the entries that actually exist
 * (primary path preferred, alternates as fallback), with `path` expanded
 * to an absolute path
 */
export function scanTargets(home: string = os.homedir()): CleanupTarget[] {
  const found: CleanupTarget[] = []
  for (const target of CLEANUP_TARGETS) {
    const candidates = [target.path, ...(target.alternatePaths ?? [])]
    const resolved = candidates.map((p) => expandHome(p, home)).find((p) => existsSync(p))
    if (resolved) found.push({ ...target, path: resolved })
  }
  return found
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
 * @zh 删除一个目标：`deleteChildren` 模式逐子项删除（含点文件），
 * 单个子项失败（如 TCC 保护）仅警告并继续其余子项；
 * 否则删除目录本身，失败向上抛
 * @en delete a target: children mode removes each child (dotfiles included),
 * warning and continuing when a single child fails (e.g. TCC-protected);
 * otherwise removes the directory itself, letting failures propagate
 */
async function deleteTarget(target: CleanupTarget): Promise<void> {
  if (target.deleteChildren) {
    for (const name of readdirSync(target.path)) {
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
  /** @zh 跳过提示清理全部检测到的目标 @en clean all detected targets without prompting */
  yes?: boolean
}

/**
 * @zh 清理可安全删除的缓存（用户缓存、日志、包管理器缓存、废纸篓等）：
 * 扫描并显示大小 → 交互式多选 → 确认 → 永久删除。
 * `-d/--dry-run` 仅预览不删除；`-y/--yes` 跳过提示清理全部；
 * 两者同时给定时 dry-run 优先
 * @en clean safely deletable caches (user caches, logs, package manager
 * caches, trash, ...): scan and show sizes → interactive multi-select →
 * confirm → permanently delete.
 * `-d/--dry-run` previews without deleting; `-y/--yes` cleans all detected
 * targets without prompting; dry run wins when both are set
 *
 * usage: `jrv cleanup` or `jrv cleanup -d` (macOS only)
 */
export async function cleanup(options: CleanupOptions = {}): Promise<void> {
  if (os.platform() !== 'darwin') {
    console.error('cleanup only works on macOS')
    process.exit(1)
  }

  const targets = scanTargets()
  if (targets.length === 0) {
    console.log('✓ nothing to clean up — no safe cache targets detected')
    return
  }

  const measured: Array<CleanupTarget & { sizeKib: number }> = []
  for (const target of targets) {
    try {
      measured.push({ ...target, sizeKib: await measureSize(target.path) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`skipping ${target.labelEn}: failed to measure size (${message})`)
    }
  }

  if (measured.length === 0) {
    console.log('✓ nothing to clean up')
    return
  }

  if (options.dryRun) {
    for (const item of measured) {
      console.log(`${item.labelEn} — ${formatSize(item.sizeKib)}`)
    }
    const totalKib = measured.reduce((sum, item) => sum + item.sizeKib, 0)
    console.log(`Total: ${formatSize(totalKib)} in ${measured.length} items`)
    return
  }

  const selected = options.yes
    ? measured.map((item) => item.id)
    : await checkbox<string>({
        message: 'Select items to clean up',
        choices: measured.map((item) => ({
          value: item.id,
          name: `${item.labelEn} — ${formatSize(item.sizeKib)}`
        }))
      })

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
