import { createRequire } from 'module'
import spawn from '@npmcli/promise-spawn'

/**
 * default handler
 */
export const add = async ({ command, options }: { command?: string; options?: { message?: boolean } }) => {
  const require = createRequire(import.meta.url)
  const changesets = require.resolve('@changesets/cli/bin.js')
  const args: string[] = []

  if (command) {
    args.push(command)
  } else if (options?.message) {
    const message = await generateChangesetMessage()

    if (message) {
      args.push('--message', message)
    }
  }

  await spawn('node', [changesets, ...args], {
    stdio: 'inherit'
  }).catch((error) => {
    console.log(error.stderr)
    return null
  })
}

/**
 * 利用 claude 分析 git diff 并生成 changeset markdown 文件
 */
const generateChangesetMessage = async () => {
  const prompt = `
# 目标

比对上次发版 commit 至当前工作区差异内容，生成 changeset summary

# 约束条件

- 仅生成 changeset summary，禁止生成任何其他内容

# 参考案例

1. 新增 \`jrv setup\`，自动安装 pnpm 与 claude-code，初始化开发环境
2. 集成 \`vitest\`，添加 switch 模块单元测试
3. 修复 \`kill\` 执行失败，没有在终端展示错误消息 Bug
`

  console.log('Generating changeset summary with Claude...')

  const { stdout: message } = await spawn('claude', ['-p', prompt], {
    stdio: 'pipe'
  }).catch((error) => {
    console.error('Failed to invoke Claude:', error.stderr || error.message)
    return { stdout: '' }
  })

  return message
}
