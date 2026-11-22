# jarvis
a common robot for common repository

## 开发环境初始化

运行 `jrv setup` 后，多选需要执行的项目，默认全部不勾选：

- 安装 pnpm（已安装则跳过）
- 安装 Claude Code（已安装则跳过）
- 初始化当前目录的 `.jarvis/settings.json`，并按需添加 `.gitignore` 规则
- 安装 Bash/Zsh 集成，支持 `jrv use` 和 `jrv nvm checkout`

空格勾选，回车执行；不选任何项目或按 Ctrl+C 取消时不作修改。
已有配置保留。仅选择 shell 集成时才会修改 `~/.bashrc` 或 `~/.zshrc`，
完成后按提示 source 对应文件或打开新终端。

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
固定为解析出的完整版本号，然后在目标 Node 的全局目录安装与当前 CLI 相同版本的 Jarvis，
并验证它可以运行。安装前会固定 npm prefix，避免全局目录配置指向旧 Node。
支持数字主版本、次版本、补丁版本，可带 `v` 前缀；
不支持 `--lts`、别名或 `.nvmrc`。安装/切换/default 设置或 Jarvis 安装验证失败会返回非零状态，
不会继续清理。nvm 安装过程本身可能切换当前版本；失败时不自动回滚安装或 PATH。
直接执行二进制（如 `command jrv nvm checkout 24`）无法修改父 shell，
因此会提示启用 shell 集成并退出，不执行安装。

`--force` 仅在安装、切换、验证、设置 default 及新 Jarvis 安装验证均成功后，
由目标 Node 下的新 Jarvis 尝试清理：

- 保留新 default 和正在执行清理的 Jarvis 运行时及安装所在版本。
  切换前的旧 Node 在安全检查通过后可以删除，不再无条件保留。
- 检测到其他 shell（包括空闲 shell）、进程检查失败、缺少 `lsof` 或无法可靠检查时，
  跳过清理并说明原因。其他非交互式 shell 也可能导致保守跳过。
- 对其他已安装版本逐一检查打开的文件；被进程使用的版本保留。
  通过 `nvm uninstall` 卸载后，仅删除该完整版本对应的 nvm `.cache/bin`、`.cache/src`
  下载缓存目录。保留其他版本、尚未安装版本的下载缓存；不执行 `nvm cache clear`。
  遇到版本目录或缓存路径的符号链接时保守跳过。
- 卸载版本会同时删除其中的**全局 npm 包**，除 Jarvis 外不自动迁移其他全局包。
  **不处理 npm/pnpm/yarn 共享缓存或项目 `node_modules`**。

关闭其他终端后，可以再次执行同一命令重试清理。进程检查只是即时快照，
无法阻止检查后有新进程启动；清理期间请勿并行启动旧 Node 或执行其他 nvm 操作。
Jarvis 使用 `$NVM_DIR/.jarvis-checkout.lock` 防止自己的 checkout 并发运行；
若进程被强制终止，确认没有 checkout 正在运行后，可手动移除遗留的空锁目录。
清理失败不会撤销已完成的切换，命令会报告失败并返回非零状态。
安全检查导致的跳过不视为 checkout 失败。

nvm 的全局工具按 Node 版本隔离。checkout 会自动安装当前版本的 Jarvis，
需要 npm registry 可用且该版本已发布；安装或验证失败时保留旧 Node，不执行清理。
其他已有终端保持自己的 PATH，只有后续加载 nvm 的终端会使用新的 default。
