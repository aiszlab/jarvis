---
"@aiszlab/jarvis": patch
---

新增 `jrv unsleep` 命令，在 macOS 上阻止屏幕熄灭和系统空闲休眠，按 `Ctrl+C` 恢复正常休眠行为。

改进 `jrv switch`，当 `~/.claude/settings.json` 或其目录不存在时自动创建。

更新 `jrv kill` 和相关命令文档，补充中英文说明；设置 Node.js 运行版本要求，并限制发布包包含的文件。
