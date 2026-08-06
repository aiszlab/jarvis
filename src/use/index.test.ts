import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// hoisted mocks must come before the dynamic import
const { checkboxMock, existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  checkboxMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: checkboxMock,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

import { shellEscape, readLocalConfig, useEnv } from "./index.js";

// ---------------------------------------------------------------------------
// shellEscape
// ---------------------------------------------------------------------------
describe("shellEscape", () => {
  it("returns the value unchanged when it contains no single quotes", () => {
    expect(shellEscape("hello")).toBe("hello");
  });

  it("escapes single quotes with '\\''", () => {
    expect(shellEscape("it's")).toBe("it'\\''s");
  });

  it("escapes multiple single quotes", () => {
    expect(shellEscape("a'b'c")).toBe("a'\\''b'\\''c");
  });

  it("returns empty string unchanged", () => {
    expect(shellEscape("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// readLocalConfig
// ---------------------------------------------------------------------------
describe("readLocalConfig", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("throws when config file does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() => readLocalConfig("/home/testuser/project")).toThrow(
      "not found",
    );
  });

  it("throws when JSON is invalid", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("not valid {{{");

    expect(() => readLocalConfig("/home/testuser/project")).toThrow(
      "failed to parse",
    );
  });

  it("throws when env field is missing", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ other: true }));

    expect(() => readLocalConfig("/home/testuser/project")).toThrow(
      "no environment variables configured",
    );
  });

  it("throws when env field is an empty object", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ env: {} }));

    expect(() => readLocalConfig("/home/testuser/project")).toThrow(
      "no environment variables configured",
    );
  });

  it("returns the env object on success", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ env: { FOO: "bar", BAZ: "qux" } }),
    );

    const result = readLocalConfig("/home/testuser/project");

    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});

// ---------------------------------------------------------------------------
// useEnv
// ---------------------------------------------------------------------------
describe("useEnv", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/home/testuser/project");
    checkboxMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
    cwdSpy.mockRestore();
  });

  it("outputs export statements for selected variables", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        env: {
          DATABASE_URL: "postgres://localhost:5432/db",
          API_KEY: "sk-abc123",
        },
      }),
    );

    checkboxMock.mockResolvedValue(["DATABASE_URL", "API_KEY"]);

    await useEnv("/home/testuser/project");

    const output = consoleLogSpy.mock.calls.map((c: any) => c[0]).join("\n");
    expect(output).toContain(
      "export DATABASE_URL='postgres://localhost:5432/db'",
    );
    expect(output).toContain("export API_KEY='sk-abc123'");
  });

  it("outputs nothing when user selects no variables", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ env: { FOO: "bar" } }));

    checkboxMock.mockResolvedValue([]);

    consoleLogSpy.mockClear();

    await useEnv("/home/testuser/project");

    const calls = consoleLogSpy.mock.calls.map((c: any) => c[0]).join("\n");
    expect(calls).toBe("");
  });

  it("escapes single quotes in values", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ env: { PASSWORD: "it's-a-secret" } }),
    );

    checkboxMock.mockResolvedValue(["PASSWORD"]);

    await useEnv("/home/testuser/project");

    const output = consoleLogSpy.mock.calls.map((c: any) => c[0]).join("\n");
    expect(output).toContain("export PASSWORD='it'\\''s-a-secret'");
  });

  it("passes checkbox the correct choices", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        env: { A: "1", B: "2" },
      }),
    );

    checkboxMock.mockResolvedValue(["A"]);

    await useEnv("/home/testuser/project");

    expect(checkboxMock).toHaveBeenCalledTimes(1);
    const callArgs = checkboxMock.mock.calls[0]![0] as {
      message: string;
      choices: Array<{ value: string; name: string }>;
    };
    expect(callArgs.message).toBe("Select environment variables to export");
    expect(callArgs.choices).toEqual([
      { value: "A", name: "A=1" },
      { value: "B", name: "B=2" },
    ]);
  });

  it("uses process.cwd() as default cwd", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ env: { X: "y" } }));
    checkboxMock.mockResolvedValue(["X"]);

    await useEnv();

    expect(existsSyncMock).toHaveBeenCalledWith(
      "/home/testuser/project/.jarvis/settings.json",
    );
  });

  it("exits with code 1 when config file does not exist", async () => {
    existsSyncMock.mockReturnValue(false);

    await useEnv("/home/testuser/project");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when JSON is invalid", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("bad json {{{");

    await useEnv("/home/testuser/project");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 0 when env field is missing", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ other: true }));

    await useEnv("/home/testuser/project");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "no environment variables configured",
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits with code 0 when env field is an empty object", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ env: {} }));

    await useEnv("/home/testuser/project");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "no environment variables configured",
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
