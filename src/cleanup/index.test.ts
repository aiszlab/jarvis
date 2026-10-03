import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import { join } from "node:path";

// hoisted mocks must come before the dynamic import
const { spawnMock, checkboxMock, confirmMock, separatorClass, existsSyncMock, readdirSyncMock, globSyncMock, lstatSyncMock, rimrafMock } =
  vi.hoisted(() => ({
    spawnMock: vi.fn(),
    checkboxMock: vi.fn(),
    confirmMock: vi.fn(),
    separatorClass: class Separator {
      constructor(public line: string) {}
    },
    existsSyncMock: vi.fn(),
    readdirSyncMock: vi.fn(),
    lstatSyncMock: vi.fn(),
    globSyncMock: vi.fn(),
    rimrafMock: vi.fn(),
  }));

vi.mock("glob", () => ({
  globSync: globSyncMock,
}));

vi.mock("@npmcli/promise-spawn", () => ({
  default: spawnMock,
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: checkboxMock,
  confirm: confirmMock,
  Separator: separatorClass,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  lstatSync: lstatSyncMock,
}));

vi.mock("rimraf", () => ({
  rimraf: rimrafMock,
}));

import {
  cleanup,
  scanTargets,
  expandHome,
  formatSize,
  measureSize,
  measureChildrenSize,
  findNodeModules,
  findGlobalNodeModules,
} from "./index.js";

// mark only the given absolute paths as existing on disk
function existingOnly(...paths: string[]) {
  const set = new Set(paths);
  existsSyncMock.mockImplementation((p: string) => set.has(p));
}

// resolve `du -sk <path>` with the given size (in KiB) per path
function duResolves(sizes: Map<string, number>) {
  spawnMock.mockImplementation((_cmd: string, args: string[]) =>
    Promise.resolve({ stdout: `${sizes.get(args[1])}\t${args[1]}\n` }),
  );
}

// build a globSync-withFileTypes entry (name + parentPath + isSymbolicLink)
function globEntry(name: string, parentPath: string, symlink = false) {
  return { name, parentPath, isSymbolicLink: () => symlink };
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
describe("cleanup", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    checkboxMock.mockReset();
    confirmMock.mockReset();
    existsSyncMock.mockReset();
    readdirSyncMock.mockReset();
    // default to an empty tree so the node_modules walk finds nothing
    readdirSyncMock.mockImplementation(() => []);
    globSyncMock.mockReset();
    globSyncMock.mockImplementation(() => []);
    lstatSyncMock.mockReset();
    lstatSyncMock.mockImplementation(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }));
    rimrafMock.mockReset();
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // throwing simulates process termination, so code after exit() never runs
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors and exits on non-macOS platforms", async () => {
    vi.spyOn(os, "platform").mockReturnValue("linux");

    await expect(cleanup()).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("cleanup only works on macOS");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("prints a friendly message and exits 0 when no targets are detected", async () => {
    existsSyncMock.mockReturnValue(false);

    await cleanup();

    expect(logSpy).toHaveBeenCalledWith(
      "✓ nothing to clean up — no cleanup targets detected",
    );
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("hints at --risky when only risky targets are detected", async () => {
    existingOnly("/Users/test/Library/Developer/CoreSimulator/Devices");

    await cleanup();

    expect(logSpy).toHaveBeenCalledWith(
      "✓ only risky targets detected — rerun with --risky to include them",
    );
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("dry run prints sizes without prompting or deleting", async () => {
    existingOnly(
      "/Users/test/Library/Caches/pnpm",
      "/Users/test/Library/Caches/Homebrew",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches/pnpm", 1024],
        ["/Users/test/Library/Caches/Homebrew", 2048],
      ]),
    );

    await cleanup({ dryRun: true });

    expect(logSpy).toHaveBeenCalledWith("Safe:");
    expect(logSpy).toHaveBeenCalledWith("  pnpm Cache — 1.00 MB");
    expect(logSpy).toHaveBeenCalledWith("  Homebrew Cache — 2.00 MB");
    expect(logSpy).toHaveBeenCalledWith("Total Reclaimable: 3.00 MB in 2 items");
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("dry run groups items by tier", async () => {
    existingOnly(
      "/Users/test/Library/Caches/pnpm",
      "/Users/test/Library/Caches",
      "/Users/test/Library/Developer/CoreSimulator/Devices",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches/pnpm", 1024],
        ["/Users/test/Library/Caches", 2048],
        ["/Users/test/Library/Developer/CoreSimulator/Devices", 4096],
      ]),
    );

    await cleanup({ dryRun: true, risky: true });

    expect(logSpy).toHaveBeenCalledWith("Safe:");
    expect(logSpy).toHaveBeenCalledWith("  pnpm Cache — 1.00 MB");
    expect(logSpy).toHaveBeenCalledWith("Moderate:");
    expect(logSpy).toHaveBeenCalledWith("  User Caches — 2.00 MB");
    expect(logSpy).toHaveBeenCalledWith("Risky:");
    expect(logSpy).toHaveBeenCalledWith("  CoreSimulator Devices — 4.00 MB");
    expect(logSpy).toHaveBeenCalledWith("Total Reclaimable: 7.00 MB in 3 items");
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("yes flag deletes all detected targets without prompting", async () => {
    existingOnly(
      "/Users/test/Library/Caches/pnpm",
      "/Users/test/Library/Caches/Homebrew",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches/pnpm", 1024],
        ["/Users/test/Library/Caches/Homebrew", 2048],
      ]),
    );

    await cleanup({ yes: true });

    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).toHaveBeenCalledWith("/Users/test/Library/Caches/pnpm");
    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/Library/Caches/Homebrew",
    );
    expect(rimrafMock).toHaveBeenCalledTimes(2);
  });

  it("yes flag skips risky targets unless --risky is set", async () => {
    existingOnly(
      "/Users/test/Library/Caches/Homebrew",
      "/Users/test/Library/Developer/CoreSimulator/Devices",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches/Homebrew", 1024],
        ["/Users/test/Library/Developer/CoreSimulator/Devices", 4096],
      ]),
    );
    readdirSyncMock.mockImplementation((p: string) =>
      p === "/Users/test/Library/Developer/CoreSimulator/Devices" ? ["dev-a"] : [],
    );

    await cleanup({ yes: true });

    expect(rimrafMock).toHaveBeenCalledWith("/Users/test/Library/Caches/Homebrew");
    expect(rimrafMock).not.toHaveBeenCalledWith(
      "/Users/test/Library/Developer/CoreSimulator/Devices/dev-a",
    );

    rimrafMock.mockClear();

    await cleanup({ yes: true, risky: true });

    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/Library/Developer/CoreSimulator/Devices/dev-a",
    );
  });

  it("detects project node_modules and lists them under moderate tier", async () => {
    globSyncMock.mockImplementation((pattern: string) =>
      pattern === "**/node_modules" ? ["projects/app/node_modules"] : [],
    );
    duResolves(new Map([["/Users/test/projects/app/node_modules", 2048]]));
    checkboxMock.mockResolvedValueOnce(["/Users/test/projects/app/node_modules"]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [
        new separatorClass("--- Moderate ---"),
        {
          value: "/Users/test/projects/app/node_modules",
          name: "[moderate] node_modules (~/projects/app) │ 2.00 MB",
        },
      ],
    });
    expect(rimrafMock).toHaveBeenCalledWith("/Users/test/projects/app/node_modules");
  });

  it("yes flag cleans detected node_modules", async () => {
    globSyncMock.mockImplementation((pattern: string) =>
      pattern === "**/node_modules" ? ["projects/app/node_modules"] : [],
    );
    duResolves(new Map([["/Users/test/projects/app/node_modules", 2048]]));

    await cleanup({ yes: true });

    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).toHaveBeenCalledWith("/Users/test/projects/app/node_modules");
  });

  it("detects global node_modules alongside project ones, keeping bundled npm", async () => {
    globSyncMock.mockImplementation((pattern: string) =>
      pattern === "/Users/test/.nvm/versions/node/*/lib/node_modules"
        ? [globEntry("node_modules", "/Users/test/.nvm/versions/node/v20.11.0/lib")]
        : [],
    );
    globSyncMock.mockImplementation((pattern: string) =>
      pattern === "**/node_modules"
        ? ["projects/app/node_modules"]
        : pattern === "/Users/test/.nvm/versions/node/*/lib/node_modules"
          ? [globEntry("node_modules", "/Users/test/.nvm/versions/node/v20.11.0/lib")]
          : [],
    );
    readdirSyncMock.mockImplementation((p: string, opts?: { withFileTypes?: boolean }) => {
      if (!opts?.withFileTypes) {
        return p === "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules"
          ? ["npm", "corepack", "typescript"]
          : [];
      }
      return [];
    });
    duResolves(
      new Map([
        ["/Users/test/projects/app/node_modules", 2048],
        ["/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules/typescript", 4096],
      ]),
    );
    checkboxMock.mockResolvedValueOnce([
      "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules",
    ]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [
        new separatorClass("--- Moderate ---"),
        {
          value: "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules",
          name: "[moderate] global node_modules (~/.nvm/versions/node/v20.11.0/lib, npm/corepack kept) │ 4.00 MB",
        },
        {
          value: "/Users/test/projects/app/node_modules",
          name: "[moderate] node_modules (~/projects/app)                                              │ 2.00 MB",
        },
      ],
    });
    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules/typescript",
    );
    expect(rimrafMock).not.toHaveBeenCalledWith(
      "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules/npm",
    );
    expect(rimrafMock).not.toHaveBeenCalledWith(
      "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules/corepack",
    );
    expect(rimrafMock).not.toHaveBeenCalledWith(
      "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules",
    );
  });

  it("skips version-managed global dirs holding only bundled npm", async () => {
    globSyncMock.mockImplementation((pattern: string) =>
      pattern === "/Users/test/.nvm/versions/node/*/lib/node_modules"
        ? [globEntry("node_modules", "/Users/test/.nvm/versions/node/v20.11.0/lib")]
        : [],
    );
    readdirSyncMock.mockImplementation((p: string, opts?: { withFileTypes?: boolean }) => {
      if (!opts?.withFileTypes) {
        return p === "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules"
          ? ["npm", "corepack"]
          : [];
      }
      return [];
    });

    await cleanup();

    expect(logSpy).toHaveBeenCalledWith(
      "✓ nothing to clean up — no cleanup targets detected",
    );
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("interactive mode deletes only the checked items", async () => {
    existingOnly(
      "/Users/test/.npm/_cacache",
      "/Users/test/Library/Caches/Homebrew",
    );
    duResolves(
      new Map([
        ["/Users/test/.npm/_cacache", 2048],
        ["/Users/test/Library/Caches/Homebrew", 1024],
      ]),
    );
    readdirSyncMock.mockImplementation((p: string) =>
      p === "/Users/test/.npm/_cacache" ? ["content", ".dot"] : [],
    );
    checkboxMock.mockResolvedValueOnce(["npm-cache"]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(logSpy).toHaveBeenCalledWith("Total Reclaimable: 3.00 MB in 2 items");
    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [
        new separatorClass("--- Safe ---"),
        { value: "npm-cache", name: "npm Cache      │ 2.00 MB" },
        { value: "homebrew-cache", name: "Homebrew Cache │ 1.00 MB" },
      ],
    });
    expect(confirmMock).toHaveBeenCalledWith({
      message:
        "clean 1 items, 2.00 MB total? This permanently deletes files.",
    });
    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/.npm/_cacache/content",
    );
    expect(rimrafMock).toHaveBeenCalledWith("/Users/test/.npm/_cacache/.dot");
    expect(rimrafMock).not.toHaveBeenCalledWith(
      "/Users/test/Library/Caches/Homebrew",
    );
    expect(rimrafMock).not.toHaveBeenCalledWith("/Users/test/.npm/_cacache");
  });

  it("returns silently when nothing is checked", async () => {
    existingOnly("/Users/test/Library/Caches/pnpm");
    duResolves(new Map([["/Users/test/Library/Caches/pnpm", 1024]]));
    checkboxMock.mockResolvedValueOnce([]);

    await cleanup();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("exits cleanly when the cleanup selection prompt is cancelled", async () => {
    existingOnly("/Users/test/Library/Caches/pnpm");
    duResolves(new Map([["/Users/test/Library/Caches/pnpm", 1024]]));
    const error = new Error("User force closed the prompt");
    error.name = "ExitPromptError";
    checkboxMock.mockRejectedValueOnce(error);

    await expect(cleanup()).resolves.toBeUndefined();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("deletes nothing when confirmation is declined", async () => {
    existingOnly("/Users/test/.Trash");
    duResolves(new Map([["/Users/test/.Trash", 2048]]));
    checkboxMock.mockResolvedValueOnce(["trash"]);
    confirmMock.mockResolvedValue(false);

    await cleanup();

    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("groups choices by tier and tags non-safe names", async () => {
    existingOnly(
      "/Users/test/Library/Caches",
      "/Users/test/Library/Developer/CoreSimulator/Devices",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches", 1024],
        ["/Users/test/Library/Developer/CoreSimulator/Devices", 2048],
      ]),
    );
    readdirSyncMock.mockReturnValue([]);
    checkboxMock.mockResolvedValueOnce(["user-caches", "core-simulator-devices"]);
    confirmMock.mockResolvedValue(true);

    await cleanup({ risky: true });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [
        new separatorClass("--- Moderate ---"),
        { value: "user-caches", name: "[moderate] User Caches │ 1.00 MB" },
        new separatorClass("--- Risky ---"),
        { value: "core-simulator-devices", name: "[risky] CoreSimulator Devices │ 2.00 MB" },
      ],
    });
  });

  it("renders aligned table rows grouped by tier", async () => {
    existingOnly("/Users/test/.npm/_cacache", "/Users/test/Library/Caches/pnpm");
    duResolves(new Map([
      ["/Users/test/.npm/_cacache", 1024],
      ["/Users/test/Library/Caches/pnpm", 2048],
    ]));
    checkboxMock.mockResolvedValueOnce(["npm-cache", "pnpm-cache"]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(checkboxMock).toHaveBeenCalledWith(expect.objectContaining({
      choices: [
        new separatorClass("--- Safe ---"),
        { value: "npm-cache", name: "npm Cache  │ 1.00 MB" },
        { value: "pnpm-cache", name: "pnpm Cache │ 2.00 MB" },
      ],
    }));
  });

  it("warns and skips targets whose size cannot be measured", async () => {
    existingOnly(
      "/Users/test/.npm/_cacache",
      "/Users/test/Library/Caches/Homebrew",
    );
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args[1] === "/Users/test/Library/Caches/Homebrew"
        ? Promise.resolve({ stdout: "2048\t/path\n" })
        : Promise.reject(new Error("boom")),
    );
    checkboxMock.mockResolvedValueOnce(["homebrew-cache"]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(warnSpy).toHaveBeenCalledWith(
      "skipping npm Cache: failed to measure size (du -sk /Users/test/.npm/_cacache failed: boom)",
    );
    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [
        new separatorClass("--- Safe ---"),
        { value: "homebrew-cache", name: "Homebrew Cache │ 2.00 MB" },
      ],
    });
    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/Library/Caches/Homebrew",
    );
  });

  it("prints nothing-to-clean when every measurement fails", async () => {
    existingOnly("/Users/test/Library/Caches/pnpm");
    spawnMock.mockRejectedValue(new Error("boom"));

    await cleanup();

    expect(logSpy).toHaveBeenCalledWith("✓ nothing to clean up");
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("dry run wins when both dryRun and yes are set", async () => {
    existingOnly("/Users/test/Library/Caches/pnpm");
    duResolves(new Map([["/Users/test/Library/Caches/pnpm", 1024]]));

    await cleanup({ dryRun: true, yes: true });

    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("  pnpm Cache — 1.00 MB");
  });

  it("prints a summary of cleaned items and freed space", async () => {
    existingOnly(
      "/Users/test/Library/Caches/pnpm",
      "/Users/test/Library/Caches/Homebrew",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches/pnpm", 1024],
        ["/Users/test/Library/Caches/Homebrew", 2048],
      ]),
    );

    await cleanup({ yes: true });

    expect(logSpy).toHaveBeenCalledWith("✓ cleaned 2 items, freed 3.00 MB");
  });

  it("deletes children of a children-mode target but never the target itself", async () => {
    existingOnly("/Users/test/Library/Caches");
    duResolves(new Map([["/Users/test/Library/Caches", 4096]]));
    readdirSyncMock.mockImplementation((p: string, opts?: { withFileTypes?: boolean }) =>
      opts?.withFileTypes ? [] : ["com.apple.foo", ".hidden"],
    );

    await cleanup({ yes: true });

    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/Library/Caches/com.apple.foo",
    );
    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/Library/Caches/.hidden",
    );
    expect(rimrafMock).not.toHaveBeenCalledWith("/Users/test/Library/Caches");
  });

  it("keeps deleting remaining children when one child fails", async () => {
    existingOnly("/Users/test/Library/Caches");
    duResolves(new Map([["/Users/test/Library/Caches", 4096]]));
    readdirSyncMock.mockImplementation((p: string, opts?: { withFileTypes?: boolean }) =>
      opts?.withFileTypes ? [] : ["protected", "ok"],
    );
    rimrafMock.mockImplementation(async (p: string) => {
      if (p === "/Users/test/Library/Caches/protected") throw new Error("busy");
    });

    await cleanup({ yes: true });

    expect(warnSpy).toHaveBeenCalledWith(
      "failed to clean /Users/test/Library/Caches/protected: busy",
    );
    expect(rimrafMock).toHaveBeenCalledWith(
      "/Users/test/Library/Caches/ok",
    );
    expect(logSpy).toHaveBeenCalledWith("✓ cleaned 1 items, freed 4.00 MB");
  });

  it("warns and continues when deleting one target fails", async () => {
    existingOnly(
      "/Users/test/Library/Caches/pnpm",
      "/Users/test/Library/Caches/Homebrew",
    );
    duResolves(
      new Map([
        ["/Users/test/Library/Caches/pnpm", 1024],
        ["/Users/test/Library/Caches/Homebrew", 2048],
      ]),
    );
    rimrafMock.mockImplementation(async (p: string) => {
      if (p === "/Users/test/Library/Caches/pnpm") throw new Error("busy");
    });

    await cleanup({ yes: true });

    expect(warnSpy).toHaveBeenCalledWith("failed to clean pnpm Cache: busy");
    expect(logSpy).toHaveBeenCalledWith("✓ cleaned 1 items, freed 2.00 MB");
  });
});

// ---------------------------------------------------------------------------
// scanTargets
// ---------------------------------------------------------------------------
describe("scanTargets", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only existing targets with ~ expanded", () => {
    existingOnly("/Users/test/Library/Caches/pnpm", "/Users/test/.Trash");

    const targets = scanTargets();

    expect(targets.map((t) => t.id)).toEqual(["pnpm-cache", "trash"]);
    expect(targets[0].path).toBe("/Users/test/Library/Caches/pnpm");
  });

  it("uses the primary path when both Yarn case variants exist", () => {
    existingOnly(
      "/Users/test/Library/Caches/Yarn",
      "/Users/test/Library/Caches/yarn",
    );

    const targets = scanTargets();

    expect(targets.map((t) => t.id)).toEqual(["yarn-cache"]);
    expect(targets[0].path).toBe("/Users/test/Library/Caches/Yarn");
  });

  it("falls back to the alternate path when the primary is missing", () => {
    existingOnly("/Users/test/Library/Caches/yarn");

    const targets = scanTargets();

    expect(targets.map((t) => t.id)).toEqual(["yarn-cache"]);
    expect(targets[0].path).toBe("/Users/test/Library/Caches/yarn");
  });

  it("excludes risky targets by default", () => {
    existingOnly(
      "/Users/test/Library/Caches/pnpm",
      "/Users/test/Library/Developer/CoreSimulator/Devices",
    );

    const targets = scanTargets();

    expect(targets.map((t) => t.id)).toEqual(["pnpm-cache"]);
  });

  it("includes risky targets when asked", () => {
    existingOnly("/Users/test/Library/Developer/CoreSimulator/Devices");

    const targets = scanTargets("/Users/test", true);

    expect(targets.map((t) => t.id)).toEqual(["core-simulator-devices"]);
  });
});

// ---------------------------------------------------------------------------
// findNodeModules
// ---------------------------------------------------------------------------
describe("findNodeModules", () => {
  beforeEach(() => {
    globSyncMock.mockReset();
    globSyncMock.mockImplementation(() => []);
    lstatSyncMock.mockReset();
    lstatSyncMock.mockImplementation(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps glob results to absolute paths and disables symlink following", () => {
    globSyncMock.mockReturnValue(["projects/app/node_modules"]);

    expect(findNodeModules("/Users/test")).toEqual([
      "/Users/test/projects/app/node_modules",
    ]);
    expect(globSyncMock).toHaveBeenCalledWith(
      "**/node_modules",
      expect.objectContaining({ cwd: "/Users/test", follow: false }),
    );
  });

  it("ignores node_modules contents and excluded top-level directories", () => {
    findNodeModules("/Users/test", ["Library"]);
    expect(globSyncMock).toHaveBeenCalledWith("**/node_modules", {
      cwd: "/Users/test",
      ignore: [
        "**/node_modules/*",
        "**/node_modules/*/**",
        "Library/**",
      ],
      follow: false,
    });
  });

  it("filters non-directories and symlinks from glob results", () => {
    globSyncMock.mockReturnValue(["link/node_modules", "file/node_modules", "app/node_modules"]);
    lstatSyncMock.mockImplementation((path: string) => ({
      isDirectory: () => path !== "/Users/test/file/node_modules",
      isSymbolicLink: () => path === "/Users/test/link/node_modules",
    }));

    expect(findNodeModules("/Users/test")).toEqual([
      "/Users/test/app/node_modules",
    ]);
  });
});

// ---------------------------------------------------------------------------
// findGlobalNodeModules
// ---------------------------------------------------------------------------
describe("findGlobalNodeModules", () => {
  beforeEach(() => {
    globSyncMock.mockReset();
    globSyncMock.mockImplementation(() => []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds nvm node_modules per Node version, skipping symlink results", () => {
    globSyncMock.mockImplementation((pattern: string) =>
      pattern === "/Users/test/.nvm/versions/node/*/lib/node_modules"
        ? [
            globEntry("node_modules", "/Users/test/.nvm/versions/node/v18.19.0/lib"),
            globEntry("node_modules", "/Users/test/.nvm/versions/node/v20.11.0/lib"),
            globEntry("node_modules", "/Users/test/.nvm/versions/node/current/lib", true),
          ]
        : [],
    );

    expect(findGlobalNodeModules("/Users/test")).toEqual([
      {
        path: "/Users/test/.nvm/versions/node/v18.19.0/lib/node_modules",
        keepChildren: ["npm", "corepack"],
      },
      {
        path: "/Users/test/.nvm/versions/node/v20.11.0/lib/node_modules",
        keepChildren: ["npm", "corepack"],
      },
    ]);
    expect(globSyncMock).toHaveBeenCalledWith(
      "/Users/test/.nvm/versions/node/*/lib/node_modules",
      { withFileTypes: true },
    );
  });

  it("finds npm, pnpm and Yarn global node_modules", () => {
    globSyncMock.mockImplementation((pattern: string) => {
      const entries: Record<string, ReturnType<typeof globEntry>[]> = {
        "/Users/test/.npm-global/lib/node_modules": [
          globEntry("node_modules", "/Users/test/.npm-global/lib"),
        ],
        "/Users/test/Library/pnpm/global/*/node_modules": [
          globEntry("node_modules", "/Users/test/Library/pnpm/global/5"),
        ],
        "/Users/test/.config/yarn/global/node_modules": [
          globEntry("node_modules", "/Users/test/.config/yarn/global"),
        ],
      };
      return entries[pattern] ?? [];
    });

    expect(findGlobalNodeModules("/Users/test")).toEqual([
      { path: "/Users/test/.npm-global/lib/node_modules" },
      { path: "/Users/test/Library/pnpm/global/5/node_modules" },
      { path: "/Users/test/.config/yarn/global/node_modules" },
    ]);
  });

  it("returns [] when no global roots match", () => {
    expect(findGlobalNodeModules("/Users/test")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// expandHome
// ---------------------------------------------------------------------------
describe("expandHome", () => {
  it("expands ~/ prefixed paths", () => {
    expect(expandHome("~/Library/Caches", "/Users/test")).toBe(
      "/Users/test/Library/Caches",
    );
  });

  it("expands a bare ~", () => {
    expect(expandHome("~", "/Users/test")).toBe("/Users/test");
  });

  it("leaves absolute and relative paths untouched", () => {
    expect(expandHome("/abs/path", "/Users/test")).toBe("/abs/path");
    expect(expandHome("relative", "/Users/test")).toBe("relative");
  });
});

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------
describe("formatSize", () => {
  it("shows plain KB below 1024", () => {
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(512)).toBe("512 KB");
    expect(formatSize(1023)).toBe("1023 KB");
  });

  it("scales to MB, GB and TB", () => {
    expect(formatSize(1024)).toBe("1.00 MB");
    expect(formatSize(1536)).toBe("1.50 MB");
    expect(formatSize(1048576)).toBe("1.00 GB");
    expect(formatSize(1073741824)).toBe("1.00 TB");
  });

  it("trims decimals as the value grows", () => {
    expect(formatSize(20480)).toBe("20.0 MB");
    expect(formatSize(204800)).toBe("200 MB");
  });
});

// ---------------------------------------------------------------------------
// measureSize
// ---------------------------------------------------------------------------
describe("measureSize", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("parses the first integer from du -sk output", async () => {
    spawnMock.mockResolvedValue({ stdout: "2048\t/Users/test/Library/Caches\n" });

    const result = await measureSize("/Users/test/Library/Caches");

    expect(spawnMock).toHaveBeenCalledWith(
      "du",
      ["-sk", "/Users/test/Library/Caches"],
      { stdio: "pipe" },
    );
    expect(result).toBe(2048);
  });

  it("rejects when du output is unparseable", async () => {
    spawnMock.mockResolvedValue({ stdout: "no numbers here" });

    await expect(measureSize("/x")).rejects.toThrow("unexpected du output");
  });

  it("parses the total when du exits non-zero on unreadable subdirectories", async () => {
    spawnMock.mockRejectedValue(
      Object.assign(new Error("command failed"), {
        stdout: "2048\t/path\n",
        stderr: "du: /path/child: Operation not permitted",
      }),
    );

    const result = await measureSize("/path");

    expect(result).toBe(2048);
  });

  it("rejects with the du failure detail when there is no output", async () => {
    spawnMock.mockRejectedValue(
      Object.assign(new Error("command failed"), {
        stdout: "",
        stderr: "du: /x: Operation not permitted",
      }),
    );

    await expect(measureSize("/x")).rejects.toThrow("du -sk /x failed");
  });
});

// ---------------------------------------------------------------------------
// measureChildrenSize
// ---------------------------------------------------------------------------
describe("measureChildrenSize", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    readdirSyncMock.mockReset();
  });

  it("sums du output for every non-kept child", async () => {
    readdirSyncMock.mockReturnValue(["npm", "corepack", "typescript", "eslint"]);
    spawnMock.mockResolvedValue({
      stdout: "1024\t/x/typescript\n2048\t/x/eslint\n",
    });

    const result = await measureChildrenSize("/x", ["npm", "corepack"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "du",
      ["-sk", "/x/typescript", "/x/eslint"],
      { stdio: "pipe" },
    );
    expect(result).toBe(3072);
  });

  it("returns 0 without spawning when every child is kept", async () => {
    readdirSyncMock.mockReturnValue(["npm", "corepack"]);

    const result = await measureChildrenSize("/x", ["npm", "corepack"]);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result).toBe(0);
  });

  it("parses the totals when du exits non-zero on unreadable children", async () => {
    readdirSyncMock.mockReturnValue(["a", "b"]);
    spawnMock.mockRejectedValue(
      Object.assign(new Error("command failed"), {
        stdout: "1024\t/a\n",
        stderr: "du: /b: Operation not permitted",
      }),
    );

    const result = await measureChildrenSize("/x");

    expect(result).toBe(1024);
  });
});
