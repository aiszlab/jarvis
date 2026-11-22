# jarvis
a common robot for common repository

## Node 版本切换（nvm-sh）

支持 macOS/Linux 的 Bash、Zsh。先安装 [nvm-sh](https://github.com/nvm-sh/nvm#installing-and-updating)，
并通过 `jrv setup` 安装 shell 集成，然后按提示 source 配置或打开新终端。
已安装 shell 集成的用户升级 Jarvis 后，需要重新 source `jarvis.sh` 或重开终端。
自定义安装位置请设置 `NVM_DIR`（默认 `~/.nvm`）。不支持 nvm-windows。
CLI 会先检查 `nvm.sh`，缺失时友好提示，不会自动安装 nvm。

```bash
jrv nvm checkout 24
jrv nvm checkout v24.15.0
jrv nvm checkout 24 --force
```

普通 checkout 安装指定版本、切换**当前终端**的 PATH，并将 nvm default
固定为解析出的完整版本号。支持数字主版本、次版本、补丁版本，可带 `v` 前缀；
不支持 `--lts`、别名或 `.nvmrc`。安装/切换/default 设置失败会返回非零状态，
不会继续清理。nvm 安装过程本身可能切换当前版本；失败时不自动回滚安装或 PATH。
直接执行二进制（如 `command jrv nvm checkout 24`）无法修改父 shell，
因此会提示启用 shell 集成并退出，不执行安装。

`--force` 仅在安装、切换、验证和设置 default 均成功后尝试清理：

- 保留新 default、切换前当前 shell 的版本，以及本次 Jarvis 的 Node 运行时和全局安装所在版本。
- 检测到其他 shell（包括空闲 shell）、进程检查失败、缺少 `lsof` 或无法可靠检查时，
  跳过清理并说明原因。其他非交互式 shell 也可能导致保守跳过。
- 对其他已安装版本逐一检查打开的文件；被进程使用的版本保留。
  通过 `nvm uninstall` 卸载后，仅删除该完整版本对应的 nvm `.cache/bin`、`.cache/src`
  下载缓存目录。保留其他版本、尚未安装版本的下载缓存；不执行 `nvm cache clear`。
  遇到版本目录或缓存路径的符号链接时保守跳过。
- 卸载版本会同时删除其中的**全局 npm 包**，不自动迁移。
  **不处理 npm/pnpm/yarn 共享缓存或项目 `node_modules`**。

关闭其他终端后，可以再次执行同一命令重试清理。进程检查只是即时快照，
无法阻止检查后有新进程启动；清理期间请勿并行启动旧 Node 或执行其他 nvm 操作。
Jarvis 使用 `$NVM_DIR/.jarvis-checkout.lock` 防止自己的 checkout 并发运行；
若进程被强制终止，确认没有 checkout 正在运行后，可手动移除遗留的空锁目录。
清理失败不会撤销已完成的切换，命令会报告失败并返回非零状态。
安全检查导致的跳过不视为 checkout 失败。

nvm 的全局工具按 Node 版本隔离。切换到新版本后，如找不到 `jrv`，请先执行
`npm install -g @aiszlab/jarvis`，再使用新版本的 Jarvis；本次操作保留旧 Jarvis 所在版本。
其他已有终端保持自己的 PATH，只有后续加载 nvm 的终端会使用新的 default。
