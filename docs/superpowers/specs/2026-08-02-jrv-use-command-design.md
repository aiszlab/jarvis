# `jrv use` — 仓库级环境变量加载命令

## 概述

新增 `jrv use` 命令，从当前仓库根目录的 `jarvis.settings.local.json` 中读取 `env` 配置，通过交互式多选让用户选择需要导出的环境变量，输出 shell `export` 语句供 `eval` 加载。

## 动机

现有 `jrv switch` 将 AI 平台配置持久化写入 `~/.claude/settings.json`，缺少仓库级别的临时环境变量管理能力。`jrv use` 填补这个空白：开发者可在仓库中放置 `jarvis.settings.local.json` 定义项目所需的环境变量（数据库连接、API key 等），按需选择性导出到当前终端会话。

## 配置文件

- 文件名：`jarvis.settings.local.json`
- 位置：`process.cwd()`（执行 `jrv use` 的目录）
- 格式：

```json
{
  "env": {
    "DATABASE_URL": "postgres://localhost:5432/mydb",
    "API_KEY": "sk-xxx",
    "DEBUG": "true"
  }
}
```

- 仅 `env` 字段会被读取；其他字段预留未来扩展

## 数据流

```
eval "$(jrv use)"
  → 查找 cwd()/jarvis.settings.local.json
  → 文件不存在 → 报错 exit(1)
  → JSON.parse → 解析失败 → 报错 exit(1)
  → 读取 env 对象 → 为空 → 提示 exit(0)
  → checkbox 多选列表（key: value 预览）
  → 用户勾选并确认
  → 对选中的每项：shell 转义 value
  → stdout 输出 "export KEY='escaped_value'"
  → shell eval 使变量在当前终端生效
```

## 实现

### 文件结构

- `src/use/index.ts` — 命令实现
- `src/use/index.test.ts` — 单元测试
- `src/index.ts` — 注册 `use` 命令

### 关键函数

```
readLocalConfig(cwd: string): Record<string, string>
  — 读取并解析 jarvis.settings.local.json，返回 env 对象

shellEscape(value: string): string
  — 对 shell 值做单引号转义

useEnv(): Promise<void>
  — 主流程：读取 → 选择 → 输出
```

### 依赖

使用已有的 `@inquirer/prompts` 中的 `checkbox` 组件。

### shell 转义规则

输出格式：`export KEY='escaped_value'`

转义：value 中的 `'` 替换为 `'\''`（结束单引号 → 转义的单引号 → 开启单引号）

## 错误处理

| 场景 | 行为 |
|---|---|
| 配置文件不存在 | `console.error` + `process.exit(1)` |
| JSON 解析失败 | `console.error` + `process.exit(1)` |
| `env` 字段缺失或为空对象 | 提示 "no environment variables configured" + `process.exit(0)` |
| 用户取消选择（0 项） | 无输出，正常退出 |

## 测试策略

遵循项目现有测试模式：`vi.hoisted()` + `vi.mock()` + 动态 `import()`。

- mock `node:fs`（existsSync, readFileSync）
- mock `@inquirer/prompts`（checkbox）
- mock `process.cwd()`
- 用例覆盖：
  - 文件不存在时报错
  - JSON 解析失败时报错
  - env 为空时提示
  - 正常流程：展示选项、用户选择、输出 export 语句
  - shell 转义正确性
  - 用户取消选择时无输出
