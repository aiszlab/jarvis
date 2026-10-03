#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { add } from './changesets/index.js'
import { setupDev } from './setup/index.js'
import { remove } from './remove/index.js'
import { switchPlatform } from './switch/index.js'
import { kill } from './kill/index.js'
import { useEnv } from './use/index.js'
import { unsleep } from './unsleep/index.js'
import { cleanup } from './cleanup/index.js'

const program = new Command()
const { version } = pkg

program.version(version, '-v, --version')

/**
 * @zh 显示当前工具包版本
 * @en display the current package version
 */
program.command('version').action(() => {
  console.log(version)
})

/**
 * @zh 使用 changesets 管理版本与变更记录
 * @en use changesets to manage versions and changelogs
 */
program
  .command('changesets')
  .alias('cs')
  .option('-v, --version', '修订 changesets 版本')
  .argument('[command]')
  .action((command?: string, options?: { version?: boolean }) => {
    add({
      command: new Set([command, options?.version ? 'version' : void 0])
        .values()
        .filter((i) => !!i)
        .toArray()
        .at(0),
    })
  })

/**
 * @zh 初始化开发环境（pnpm + claude-code），生成配置文件，
 * 并安装 shell 集成（将 jarvis.sh source 到 ~/.zshrc / ~/.bashrc）
 * @en initialize dev environment (pnpm + claude-code), scaffold config file,
 * and install shell integration (source jarvis.sh into ~/.zshrc / ~/.bashrc)
 */
program.command('setup').action(() => {
  setupDev()
})

/**
 * @zh 交互式切换平台与模型，配置持久化到 ~/.claude/settings.json
 * @en switch platform & model, persists config to ~/.claude/settings.json
 */
program
  .command('switch')
  .alias('sw')
  .action(() => {
    switchPlatform()
  })

/**
 * @zh 类似 `rm -rf`
 * @en like `rm -rf`
 */
program
  .command('remove')
  .alias('rm')
  .argument('<pathname>')
  .action((pathname: string) => {
    remove(pathname)
  })

/**
 * @zh 杀掉占用指定端口的进程
 * @en kill the process listening on a given port
 *
 * usage: `jrv kill 8080` or `jrv kill` (interactive prompt)
 */
program
  .command('kill')
  .alias('k')
  .argument('[port]', 'port number', (value) => {
    const port = Number(value)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new InvalidArgumentError('port must be an integer in 0..65535')
    }
    return port
  })
  .action(async (port?: number) => {
    await kill(port)
  })

/**
 * @zh 交互式选择 .jarvis/settings.json 中的环境变量，输出 export 语句供 shell eval
 * @en load environment variables from .jarvis/settings.json interactively
 * and output export statements for shell eval
 *
 * usage: just run `jrv use` — the shell wrapper handles eval automatically.
 * (requires shell integration via `jrv setup`)
 */
program.command('use').action(async () => {
  await useEnv()
})

/**
 * @zh 保持 Mac 不休眠（阻止屏幕熄灭与系统空闲休眠），Ctrl+C 恢复
 * @en keep the machine awake (prevent display + system sleep) until Ctrl+C
 *
 * usage: `jrv unsleep` (macOS only)
 */
program.command('unsleep').action(async () => {
  await unsleep()
})

/**
 * @zh 清理 Mac 上的垃圾文件（包管理器缓存、Xcode DerivedData、废纸篓、
 * 用户缓存/日志、主目录下各项目的 node_modules 等），
 * 按 safe / moderate / risky 分级交互式多选；
 * `-d` 仅预览不删除，`-y` 跳过提示直接清理全部（不含 risky），
 * `-r` 将 risky 级目标（如 iOS 模拟器数据）纳入
 * @en clean junk files on macOS (package manager caches, Xcode DerivedData,
 * trash, user caches / logs, project node_modules under home, ...) with a
 * safe / moderate / risky tiered interactive multi-select; `-d` previews
 * sizes without deleting, `-y` skips prompts and cleans all detected targets
 * (risky excluded), `-r` includes risky-tier targets (e.g. CoreSimulator
 * devices)
 *
 * usage: `jrv cleanup` or `jrv cleanup -d` (macOS only)
 */
program
  .command('cleanup')
  .alias('cl')
  .option('-d, --dry-run', 'show sizes without deleting anything')
  .option('-y, --yes', 'clean all detected targets without prompting')
  .option('-r, --risky', 'include risky targets (deletes user data, e.g. CoreSimulator devices)')
  .action(async (options: { dryRun?: boolean; yes?: boolean; risky?: boolean }) => {
    await cleanup(options)
  })

program.parse()
