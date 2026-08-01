# @aiszlab/jarvis

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
