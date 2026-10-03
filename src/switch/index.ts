import { select, input } from "@inquirer/prompts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

/**
 * @zh 需要用户手动填写的输入字段
 * @en an input field the user must fill in manually
 */
interface InputField {
  message: string;
  default?: () => string;
}

/**
 * @zh 带静态环境变量与交互式输入的模型预设
 * @en a model preset with static env vars and interactive inputs
 */
interface ModelPreset {
  label: string;
  /** @zh 静态环境变量（直接写入） @en static env vars — written directly */
  env: Record<string, string>;
  /** @zh 交互式输入（逐个提示用户填写） @en interactive inputs — user is prompted to fill in each one */
  inputs?: Record<string, InputField>;
}

/**
 * @zh 各平台的模型预设
 * @en model presets for each platform
 */
const PLATFORMS: Record<string, { label: string; models: Record<string, ModelPreset> }> = {
  "claude-code": {
    label: "Claude Code",
    models: {
      "deepseek-v4": {
        label: "DeepSeek V4",
        env: {
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_MODEL: "deepseek-v4-pro[1m]",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
          CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4-flash",
          CLAUDE_CODE_EFFORT_LEVEL: "max",
        },
        inputs: {
          ANTHROPIC_AUTH_TOKEN: {
            message: "Enter your ANTHROPIC_AUTH_TOKEN",
          },
        },
      },
      "ark-coding-plan": {
        label: "Ark Coding Plan",
        env: {
          ANTHROPIC_BASE_URL: "https://ark.cn-beijing.volces.com/api/coding",
          ANTHROPIC_MODEL: "ark-code-latest",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "ark-code-latest",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "ark-code-latest",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "ark-code-latest",
          CLAUDE_CODE_SUBAGENT_MODEL: "ark-code-latest",
        },
        inputs: {
          ANTHROPIC_AUTH_TOKEN: {
            message: "Enter your ANTHROPIC_AUTH_TOKEN (ark-xxx)",
          },
        },
      },
    },
  },
};

type PlatformKey = keyof typeof PLATFORMS;

/**
 * @zh 读取 ~/.claude/settings.json，返回解析后的对象或空对象
 * @en read existing ~/.claude/settings.json, returns parsed object or empty object
 */
export function readSettings(): Record<string, unknown> {
  if (!existsSync(SETTINGS_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    console.warn(`Warning: failed to parse ${SETTINGS_PATH}, starting fresh`);
    return {};
  }
}

/**
 * @zh 将配置写入 ~/.claude/settings.json（文件或目录不存在时默认创建）
 * @en write settings to ~/.claude/settings.json, creating the file & directory by default
 */
export function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

/**
 * @zh 遍历模型的 `inputs` 配置，逐个提示用户填写
 * @en iterate over the model's `inputs` config and prompt the user for each field
 */
export async function collectInputs(inputs: Record<string, InputField>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, field] of Object.entries(inputs)) {
    result[key] = await input({
      message: field.message,
      default: field.default?.() ?? "",
    });
  }
  return result;
}

/**
 * @zh 切换平台与模型，配置持久化到 ~/.claude/settings.json
 * @en switch platform & model, persist config to ~/.claude/settings.json
 */
export const switchPlatform = async () => {
  // step 1 — choose platform
  const platform = await select<PlatformKey>({
    message: "Select a platform",
    choices: Object.entries(PLATFORMS).map(([value, { label }]) => ({
      value: value as PlatformKey,
      name: label,
    })),
  });

  // step 2 — choose model
  const platformDef = PLATFORMS[platform];
  const model = await select<string>({
    message: `Select a model for ${platformDef.label}`,
    choices: Object.entries(platformDef.models).map(([value, { label }]) => ({
      value,
      name: label,
    })),
  });

  const modelDef = platformDef.models[model]!;

  // step 3 — collect input fields configured on the model
  const inputVars = modelDef.inputs
    ? await collectInputs(modelDef.inputs)
    : {};

  // step 4 — read existing settings and merge env vars
  const settings = readSettings();
  const existingEnv = (settings.env as Record<string, string>) ?? {};

  // preset takes priority over existing; inputs override both
  settings.env = { ...existingEnv, ...modelDef.env, ...inputVars };

  // step 5 — write back to settings.json
  writeSettings(settings);

  console.log(
    `✓ switched to ${platformDef.label} / ${modelDef.label}`,
  );
  console.log(`  updated ${SETTINGS_PATH}`);
};

