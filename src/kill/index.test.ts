import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";

// hoisted mocks must come before the dynamic import
const { spawnMock, inputMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  inputMock: vi.fn(),
}));

vi.mock("@npmcli/promise-spawn", () => ({
  default: spawnMock,
}));

vi.mock("@inquirer/prompts", () => ({
  input: inputMock,
}));

import { findPidsByPort, killPort, kill } from "./index.js";

// ---------------------------------------------------------------------------
// findPidsByPort
// ---------------------------------------------------------------------------
describe("findPidsByPort", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.spyOn(os, "platform").mockReturnValue("darwin");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns PIDs parsed from lsof output on macOS/linux", async () => {
    spawnMock.mockResolvedValue({ stdout: "1234\n5678\n" });

    const result = await findPidsByPort(8080);

    expect(spawnMock).toHaveBeenCalledWith("lsof", ["-ti", ":8080"], {
      stdio: "pipe",
    });
    expect(result).toEqual([1234, 5678]);
  });

  it("returns an empty array when lsof exits non-zero (no match)", async () => {
    spawnMock.mockRejectedValue(new Error("no match"));

    const result = await findPidsByPort(8080);

    expect(result).toEqual([]);
  });

  it("filters out empty / non-integer lines from lsof output", async () => {
    spawnMock.mockResolvedValue({ stdout: "1234\n\n   \n5678\n" });

    const result = await findPidsByPort(3000);

    expect(result).toEqual([1234, 5678]);
  });

  it("parses LISTENING rows from netstat on windows and dedupes PIDs", async () => {
    vi.spyOn(os, "platform").mockReturnValue("win32");
    const netstatOutput = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1234",
      "  TCP    [::]:8080              [::]:0                 LISTENING       1234",
      "  TCP    0.0.0.0:9090           0.0.0.0:0              LISTENING       5678",
    ].join("\r\n");
    spawnMock.mockResolvedValue({ stdout: netstatOutput });

    const result = await findPidsByPort(8080);

    expect(spawnMock).toHaveBeenCalledWith("netstat", ["-ano"], {
      stdio: "pipe",
    });
    expect(result).toEqual([1234]);
  });

  it("does not match substring ports on windows (:80 vs :8080)", async () => {
    vi.spyOn(os, "platform").mockReturnValue("win32");
    const netstatOutput = [
      "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1234",
    ].join("\r\n");
    spawnMock.mockResolvedValue({ stdout: netstatOutput });

    const result = await findPidsByPort(80);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// killPort
// ---------------------------------------------------------------------------
describe("killPort", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(os, "platform").mockReturnValue("darwin");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends SIGKILL to every PID found on the port", async () => {
    spawnMock.mockResolvedValue({ stdout: "1234\n5678\n" });

    await killPort(8080);

    expect(killSpy).toHaveBeenCalledWith(1234, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(5678, "SIGKILL");

    const output = logSpy.mock.calls.map((c: any) => c[0]).join("\n");
    expect(output).toContain("killed process 1234 on port 8080");
    expect(output).toContain("killed process 5678 on port 8080");
  });

  it("does not kill anything and logs when no process is found", async () => {
    spawnMock.mockRejectedValue(new Error("no match"));

    await killPort(8080);

    expect(killSpy).not.toHaveBeenCalled();

    const output = logSpy.mock.calls.map((c: any) => c[0]).join("\n");
    expect(output).toContain("no process found on port 8080");
  });
});

// ---------------------------------------------------------------------------
// kill
// ---------------------------------------------------------------------------
describe("kill", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    inputMock.mockReset();
    spawnMock.mockReset();
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(os, "platform").mockReturnValue("darwin");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prompts for a port when none is provided", async () => {
    inputMock.mockResolvedValue("8080");
    spawnMock.mockResolvedValue({ stdout: "1234\n" });

    await kill();

    expect(inputMock).toHaveBeenCalledWith({ message: "Enter port number" });
    expect(spawnMock).toHaveBeenCalledWith("lsof", ["-ti", ":8080"], {
      stdio: "pipe",
    });
    expect(killSpy).toHaveBeenCalledWith(1234, "SIGKILL");
  });

  it("uses the provided port without prompting", async () => {
    spawnMock.mockResolvedValue({ stdout: "1234\n" });

    await kill(8080);

    expect(inputMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledWith("lsof", ["-ti", ":8080"], {
      stdio: "pipe",
    });
  });

  it("rejects an invalid port entered interactively", async () => {
    inputMock.mockResolvedValue("abc");

    await kill();

    expect(errorSpy).toHaveBeenCalledWith(
      "port must be an integer in 0..65535",
    );
    expect(spawnMock).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });
});
