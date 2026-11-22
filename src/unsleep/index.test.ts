import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";

// hoisted mocks must come before the dynamic import
const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("@npmcli/promise-spawn", () => ({
  default: spawnMock,
}));

import { unsleep } from "./index.js";

// ---------------------------------------------------------------------------
// unsleep
// ---------------------------------------------------------------------------
describe("unsleep", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // throwing simulates process termination, so code after exit() never runs
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(os, "platform").mockReturnValue("darwin");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawns caffeinate with -d -i -u on macOS", async () => {
    spawnMock.mockResolvedValue({});

    await unsleep();

    expect(spawnMock).toHaveBeenCalledWith("caffeinate", ["-d", "-i", "-u"], {
      stdio: "inherit",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("errors and exits on non-macOS platforms", async () => {
    vi.spyOn(os, "platform").mockReturnValue("linux");

    await expect(unsleep()).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith(
      "unsleep only works on macOS (requires caffeinate)",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("exits quietly when caffeinate is interrupted by SIGINT (Ctrl+C)", async () => {
    spawnMock.mockRejectedValue(
      Object.assign(new Error("command failed"), {
        signal: "SIGINT",
        code: null,
      }),
    );

    await unsleep();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("reports real caffeinate failures", async () => {
    spawnMock.mockRejectedValue(new Error("spawn caffeinate ENOENT"));

    await expect(unsleep()).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith(
      "caffeinate failed: spawn caffeinate ENOENT",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
