import { select, input } from "@inquirer/prompts";

/**
 * @description
 * an input field the user must fill in manually
 */
interface InputField {
  message: string;
  default?: () => string;
}

/**
 * @description
 * a model preset with static env vars and interactive inputs
 */
interface ModelPreset {
  label: string;
  /** static env vars — written directly */
  env: Record<string, string>;
  /** interactive inputs — user is prompted to fill in each one */
  inputs?: Record<string, InputField>;
}

/**
 * @description
 * model presets for each platform
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
            default: () => process.env.ANTHROPIC_AUTH_TOKEN ?? "",
          },
        },
      },
    },
  },
};

type PlatformKey = keyof typeof PLATFORMS;

/**
 * @description
 * collect existing env values from current process (static env keys only)
 */
export function collectExistingEnv(platform: PlatformKey): Record<string, string> {
  const existing: Record<string, string> = {};
  const modelPresets = PLATFORMS[platform].models;

  for (const [, preset] of Object.entries(modelPresets)) {
    for (const key of Object.keys(preset.env)) {
      if (process.env[key]) {
        existing[key] = process.env[key]!;
      }
    }
  }

  return existing;
}

/**
 * @description
 * iterate over the model's `inputs` config and prompt the user for each field
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
 * @description
 * switch platform & model, output export commands for the shell
 *
 * usage: eval "$(jar switch)"
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

  // step 4 — collect env vars (preset + existing + inputs)
  const existing = collectExistingEnv(platform);

  // preset takes priority over existing; inputs override both
  const merged = { ...existing, ...modelDef.env, ...inputVars };

  // step 5 — output export commands
  const exports = Object.entries(merged)
    .map(([key, value]) => `export ${key}="${value}"`)
    .join("\n");

  console.log(exports);
  console.log(
    `# switched to ${platformDef.label} / ${modelDef.label}`,
  );
};

