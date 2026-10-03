# @aiszlab/jarvis

## 1.1.1

### Patch Changes

- f086f23: 新增 `jrv unsleep` 命令，在 macOS 上阻止屏幕熄灭和系统空闲休眠，按 `Ctrl+C` 恢复正常休眠行为。

  改进 `jrv switch`，当 `~/.claude/settings.json` 或其目录不存在时自动创建。

  更新 `jrv kill` 和相关命令文档，补充中英文说明；设置 Node.js 运行版本要求，并限制发布包包含的文件。

- 5ac13e2: 1. 新增 `jrv use` 命令，交互式选择环境变量并输出 `export` 语句，配合 `eval "$(jrv use)"` 使用 2. 新增 `jrv changesets -m` 选项，自动调用 Claude 分析 git diff 生成 changeset summary 3. 扩展 `jrv setup`，自动初始化 `.jarvis.settings.json` 配置文件并写入 `.gitignore` 4. 统一代码风格，双引号改单引号、移除分号
- 0080f8c: 1. 新增 `jrv cleanup`（别名 `cl`）命令，交互式清理 macOS 安全缓存（用户缓存、日志、npm/pnpm/Yarn/Homebrew/pip 缓存、Xcode DerivedData、废纸篓），支持 `-d` 预览与 `-y` 全量清理

## 1.1.0

### Minor Changes

- Add `kill` command (`jrv kill <port>` / alias `k`) to stop the process listening on a given port. Works on macOS/linux via `lsof` and on windows via `netstat`.
- `jrv switch` 改为直接修改 `~/.claude/settings.json`，不再输出 shell export 命令

## 1.0.5

### Patch Changes

- changesets -v 选项映射为 version 子命令传入 add

## 1.0.4

### Patch Changes

- 新增 `jrv setup` — 自动安装 pnpm 与 claude-code，初始化开发环境
- 新增 `jrv switch` — 交互式切换 AI 平台/模型，输出 shell 环境变量
- CLI 二进制重命名 `z` → `jrv`
- 集成 vitest，添加 switch 模块单元测试
- 升级 commander、typescript 等依赖，新增 @inquirer/prompts

## 1.0.3

### Patch Changes

- add `rm` command

## 1.0.2

### Patch Changes

- chore(pkg): bin alias & add action flow

## 1.0.1

### Patch Changes

- feat(changesets): add changesets cli into jarvis
