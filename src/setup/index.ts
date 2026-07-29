import spawn from "@npmcli/promise-spawn";

/**
 * @description
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
 * @description
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

  console.log("\ndev environment ready!");
};
