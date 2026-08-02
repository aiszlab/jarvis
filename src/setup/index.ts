import spawn from "@npmcli/promise-spawn";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "jarvis.settings.local.json";

/**
 * check if a command is installed
 */
async function isInstalled(command: string): Promise<boolean> {
  try {
    await spawn("which", [command], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * ensure jarvis.settings.local.json exists in cwd, and add it to .gitignore
 * if git would otherwise track it.
 */
async function initConfig(cwd: string): Promise<void> {
  const configPath = join(cwd, CONFIG_FILE);

  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify({ env: {} }, null, 2) + "\n",
    );
    console.log(`created ${CONFIG_FILE} ✓`);
  } else {
    console.log(`${CONFIG_FILE} already exists ✓`);
  }

  // gitignore — only when inside a git repo
  const gitignorePath = join(cwd, ".gitignore");

  // not a git repo — nothing to do
  if (!existsSync(join(cwd, ".git"))) return;

  try {
    // if check-ignore succeeds (exit 0), the file is already ignored
    await spawn("git", ["check-ignore", "-q", CONFIG_FILE], {
      cwd,
      stdio: "pipe",
    });
    console.log(`${CONFIG_FILE} is already gitignored ✓`);
  } catch {
    // exit non-zero means the file is not gitignored; add it
    const entry = `${CONFIG_FILE}\n`;

    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (content.includes(CONFIG_FILE)) {
        console.log(`${CONFIG_FILE} is already gitignored ✓`);
        return;
      }
      appendFileSync(gitignorePath, `\n${entry}`);
    } else {
      writeFileSync(gitignorePath, `${entry}\n`);
    }
    console.log(`added ${CONFIG_FILE} to .gitignore ✓`);
  }
}

/**
 * initialize dev environment
 */
export const setupDev = async () => {
  // 1. install pnpm
  const hasPnpm = await isInstalled("pnpm");
  if (hasPnpm) {
    console.log("pnpm already installed ✓");
  } else {
    console.log("installing pnpm...");
    await spawn("npm", ["install", "-g", "pnpm"], { stdio: "inherit" });
    console.log("pnpm installed ✓");
  }

  // 2. install claude-code
  const hasClaude = await isInstalled("claude");
  if (hasClaude) {
    console.log("claude-code already installed ✓");
  } else {
    console.log("installing claude-code...");
    await spawn("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
      stdio: "inherit",
    });
    console.log("claude-code installed ✓");
  }

  // 3. initialize jarvis.settings.local.json + gitignore
  await initConfig(process.cwd());

  console.log("\ndev environment ready!");
};
