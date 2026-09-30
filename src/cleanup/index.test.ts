import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import { join } from "node:path";

// hoisted mocks must come before the dynamic import
const { spawnMock, checkboxMock, confirmMock, existsSyncMock, readdirSyncMock, rimrafMock } =
  vi.hoisted(() => ({
    spawnMock: vi.fn(),
    checkboxMock: vi.fn(),
    confirmMock: vi.fn(),
    existsSyncMock: vi.fn(),
    readdirSyncMock: vi.fn(),
    rimrafMock: vi.fn(),
  }));

vi.mock("@npmcli/promise-spawn", () => ({
  default: spawnMock,
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: checkboxMock,
  confirm: confirmMock,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
}));

vi.mock("rimraf", () => ({
  rimraf: rimrafMock,
}));

import { cleanup, scanTargets, expandHome, formatSize, measureSize } from "./index.js";

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
      "✓ nothing to clean up — no safe cache targets detected",
    );
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
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

    expect(logSpy).toHaveBeenCalledWith("pnpm Cache — 1.00 MB");
    expect(logSpy).toHaveBeenCalledWith("Homebrew Cache — 2.00 MB");
    expect(logSpy).toHaveBeenCalledWith("Total: 3.00 MB in 2 items");
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
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
    checkboxMock.mockResolvedValue(["npm-cache"]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [
        { value: "npm-cache", name: "npm Cache — 2.00 MB" },
        { value: "homebrew-cache", name: "Homebrew Cache — 1.00 MB" },
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
    checkboxMock.mockResolvedValue([]);

    await cleanup();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(rimrafMock).not.toHaveBeenCalled();
  });

  it("deletes nothing when confirmation is declined", async () => {
    existingOnly("/Users/test/.Trash");
    duResolves(new Map([["/Users/test/.Trash", 2048]]));
    checkboxMock.mockResolvedValue(["trash"]);
    confirmMock.mockResolvedValue(false);

    await cleanup();

    expect(rimrafMock).not.toHaveBeenCalled();
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
    checkboxMock.mockResolvedValue(["homebrew-cache"]);
    confirmMock.mockResolvedValue(true);

    await cleanup();

    expect(warnSpy).toHaveBeenCalledWith(
      "skipping npm Cache: failed to measure size (du -sk /Users/test/.npm/_cacache failed: boom)",
    );
    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select items to clean up",
      choices: [{ value: "homebrew-cache", name: "Homebrew Cache — 2.00 MB" }],
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
    expect(logSpy).toHaveBeenCalledWith("pnpm Cache — 1.00 MB");
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
    readdirSyncMock.mockReturnValue(["com.apple.foo", ".hidden"]);

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
    readdirSyncMock.mockReturnValue(["protected", "ok"]);
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
