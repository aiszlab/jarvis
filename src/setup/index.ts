import spawn from "@npmcli/promise-spawn"
import { existsSync, writeFileSync, appendFileSync, readFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"

const CONFIG_FILE = ".jarvis/settings.json"

/** single-line shell snippet that locates jarvis.sh relative to the jrv binary */
const SOURCE_LINE = `source "\$(dirname "\$(realpath "\$(command -v jrv)")")/../jarvis.sh"`

/**
 * check if a command is installed
 */
async function isInstalled(command: string): Promise<boolean> {
  try {
    await spawn("which", [command], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

/**
 * ensure .jarvis/settings.json exists in cwd, and add .jarvis/ to .gitignore
 * if git would otherwise track it.
 */
async function initConfig(cwd: string): Promise<void> {
  const configPath = join(cwd, CONFIG_FILE)
  const configDir = dirname(configPath)

  if (!existsSync(configPath)) {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({ env: {} }, null, 2) + "\n",
    )
    console.log(`created ${CONFIG_FILE} ✓`)
  } else {
    console.log(`${CONFIG_FILE} already exists ✓`)
  }

  // gitignore — only when inside a git repo
  const gitignorePath = join(cwd, ".gitignore")

  // not a git repo — nothing to do
  if (!existsSync(join(cwd, ".git"))) return

  const gitignoreEntry = ".jarvis/\n"

  try {
    // if check-ignore succeeds (exit 0), the file is already ignored
    await spawn("git", ["check-ignore", "-q", CONFIG_FILE], {
      cwd,
      stdio: "pipe",
    })
    console.log(`.jarvis/ is already gitignored ✓`)
  } catch {
    // exit non-zero means the file is not gitignored; add it
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8")
      if (content.includes(".jarvis")) {
        console.log(`.jarvis/ is already gitignored ✓`)
        return
      }
      appendFileSync(gitignorePath, `\n${gitignoreEntry}`)
    } else {
      writeFileSync(gitignorePath, `${gitignoreEntry}\n`)
    }
    console.log(`added .jarvis/ to .gitignore ✓`)
  }
}

/**
 * detect the user's shell rc file path.
 * returns the full path to ~/.zshrc, ~/.bashrc, or ~/.zshrc as default.
 */
function detectRcFile(): { shell: string; rcPath: string } {
  const shell = process.env.SHELL ?? ""
  const home = homedir()

  if (shell.includes("bash")) {
    return { shell: "bash", rcPath: join(home, ".bashrc") }
  }

  return { shell: "zsh", rcPath: join(home, ".zshrc") }
}

/**
 * add a single `source` line to the user's shell rc file if not already present.
 * uses `command -v jrv` + `realpath` to locate jarvis.sh relative to the binary at shell time.
 */
function installShellIntegration(rcPath: string): void {
  if (existsSync(rcPath)) {
    const content = readFileSync(rcPath, "utf-8")
    if (content.includes("jarvis.sh")) {
      console.log(`shell integration already present in ${rcPath} ✓`)
      return
    }
  }

  appendFileSync(rcPath, `\n${SOURCE_LINE}\n`)
  console.log(`added shell integration to ${rcPath} ✓`)
}

/**
 * initialize dev environment
 */
export const setupDev = async () => {
  // 1. install pnpm
  const hasPnpm = await isInstalled("pnpm")
  if (hasPnpm) {
    console.log("pnpm already installed ✓")
  } else {
    console.log("installing pnpm...")
    await spawn("npm", ["install", "-g", "pnpm"], { stdio: "inherit" })
    console.log("pnpm installed ✓")
  }

  // 2. install claude-code
  const hasClaude = await isInstalled("claude")
  if (hasClaude) {
    console.log("claude-code already installed ✓")
  } else {
    console.log("installing claude-code...")
    await spawn("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
      stdio: "inherit",
    })
    console.log("claude-code installed ✓")
  }

  // 3. initialize .jarvis/settings.json + gitignore
  await initConfig(process.cwd())

  // 4. install shell integration (source jarvis.sh → defines jrv() wrapper)
  const { shell, rcPath } = detectRcFile()
  console.log(`\ndetected shell: ${shell}`)
  installShellIntegration(rcPath)

  console.log(`\nto activate, run: source "${rcPath}"`)
  console.log("dev environment ready!")
}
