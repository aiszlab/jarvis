import { checkbox } from "@inquirer/prompts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * escape a value for use in a shell single-quoted string.
 * replaces every `'` with `'\''` so the value is safe inside `export KEY='...'`.
 */
export function shellEscape(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

/**
 * read `jarvis.settings.local.json` from `cwd` and return the `env` object.
 * throws when the file is missing, cannot be parsed, or has no `env` field.
 */
export function readLocalConfig(cwd: string): Record<string, string> {
  const configPath = join(cwd, "jarvis.settings.local.json");

  if (!existsSync(configPath)) {
    throw new Error(
      `${configPath} not found. Create a jarvis.settings.local.json to use this feature.`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    throw new Error(`failed to parse ${configPath}`);
  }

  const env = parsed.env as Record<string, string> | undefined;
  if (!env || typeof env !== "object" || Object.keys(env).length === 0) {
    throw new Error("no environment variables configured");
  }

  return env;
}

/**
 * @description
 * load environment variables from jarvis.settings.local.json interactively
 * and output `export` statements to stdout.
 *
 * usage: `eval "$(jrv use)"`
 */
export const useEnv = async (cwd: string = process.cwd()) => {
  let env: Record<string, string>;
  try {
    env = readLocalConfig(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "no environment variables configured") {
      console.log(message);
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(message === "no environment variables configured" ? 0 : 1);
    return; // unreachable, but needed when process.exit is mocked in tests
  }

  const entries = Object.entries(env);

  const selected = await checkbox<string>({
    message: "Select environment variables to export",
    choices: entries.map(([key, value]) => ({
      value: key,
      name: `${key}=${value}`,
    })),
  });

  if (selected.length === 0) {
    return;
  }

  const exports = selected
    .map((key) => `export ${key}='${shellEscape(env[key]!)}'`)
    .join("\n");

  console.log(exports);
};
