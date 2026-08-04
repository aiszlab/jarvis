---
'@aiszlab/jarvis': patch
---

1. 新增 `jrv use` 命令，交互式选择环境变量并输出 `export` 语句，配合 `eval "$(jrv use)"` 使用
2. 新增 `jrv changesets -m` 选项，自动调用 Claude 分析 git diff 生成 changeset summary
3. 扩展 `jrv setup`，自动初始化 `.jarvis.settings.json` 配置文件并写入 `.gitignore`
4. 统一代码风格，双引号改单引号、移除分号
