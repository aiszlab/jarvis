import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// hoisted mocks must come before the dynamic import
const { inputMock, selectMock, existsSyncMock, readFileSyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  inputMock: vi.fn(),
  selectMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: selectMock,
  input: inputMock,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

import { collectInputs, readSettings, writeSettings, switchPlatform } from "./index.js";

// ---------------------------------------------------------------------------
// readSettings
// ---------------------------------------------------------------------------
describe("readSettings", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("returns empty object when settings file does not exist", () => {
    existsSyncMock.mockReturnValue(false);
    const result = readSettings();
    expect(result).toEqual({});
  });

  it("parses and returns existing settings", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ env: { ANTHROPIC_MODEL: "claude-sonnet-5" } }),
    );
    const result = readSettings();
    expect(result).toEqual({ env: { ANTHROPIC_MODEL: "claude-sonnet-5" } });
  });

  it("returns empty object and warns on invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("not valid json {{{");

    const result = readSettings();
    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse"),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// writeSettings
// ---------------------------------------------------------------------------
describe("writeSettings", () => {
  beforeEach(() => {
    writeFileSyncMock.mockReset();
  });

  it("writes settings to ~/.claude/settings.json as formatted JSON", () => {
    const settings = { env: { ANTHROPIC_MODEL: "test-model" } };
    writeSettings(settings);

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      "/home/testuser/.claude/settings.json",
      JSON.stringify(settings, null, 2) + "\n",
    );
  });
});

// ---------------------------------------------------------------------------
// collectInputs
// ---------------------------------------------------------------------------
describe("collectInputs", () => {
  beforeEach(() => {
    inputMock.mockReset();
  });

  it("calls input() for each field and returns collected values", async () => {
    inputMock
      .mockResolvedValueOnce("sk-abc123")
      .mockResolvedValueOnce("gpt-5");

    const result = await collectInputs({
      API_KEY: { message: "Enter API key" },
      MODEL: { message: "Enter model name" },
    });

    expect(inputMock).toHaveBeenCalledTimes(2);
    expect(inputMock).toHaveBeenNthCalledWith(1, {
      message: "Enter API key",
      default: "",
    });
    expect(inputMock).toHaveBeenNthCalledWith(2, {
      message: "Enter model name",
      default: "",
    });
    expect(result).toEqual({ API_KEY: "sk-abc123", MODEL: "gpt-5" });
  });

  it("uses field.default() as the default value", async () => {
    inputMock.mockResolvedValue("user-input");

    const result = await collectInputs({
      TOKEN: {
        message: "Enter token",
        default: () => "fallback-token",
      },
    });

    expect(inputMock).toHaveBeenCalledWith({
      message: "Enter token",
      default: "fallback-token",
    });
    expect(result.TOKEN).toBe("user-input");
  });

  it("uses empty string default when field has no default function", async () => {
    inputMock.mockResolvedValue("typed-value");

    const result = await collectInputs({
      NAME: { message: "Your name" },
    });

    expect(inputMock).toHaveBeenCalledWith({
      message: "Your name",
      default: "",
    });
    expect(result.NAME).toBe("typed-value");
  });

  it("returns empty object for empty inputs record", async () => {
    const result = await collectInputs({});
    expect(result).toEqual({});
    expect(inputMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// switchPlatform
// ---------------------------------------------------------------------------
describe("switchPlatform", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    selectMock.mockReset();
    inputMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = originalEnv;
  });

  const PRESET_ENV = {
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_MODEL: "deepseek-v4-pro[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
    CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4-flash",
    CLAUDE_CODE_EFFORT_LEVEL: "max",
  };

  it("writes env vars to settings.json for the selected platform & model", async () => {
    selectMock.mockResolvedValueOnce("claude-code");
    selectMock.mockResolvedValueOnce("deepseek-v4");
    inputMock.mockResolvedValueOnce("sk-token-123");

    // clear env so the default is empty string
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    // settings file exists with unrelated keys
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ theme: "dark", plugins: [] }),
    );

    await switchPlatform();

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(inputMock).toHaveBeenCalledTimes(1);
    expect(inputMock).toHaveBeenCalledWith({
      message: "Enter your ANTHROPIC_AUTH_TOKEN",
      default: "",
    });

    // verify settings.json was written with merged data
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeFileSyncMock.mock.calls[0] as [string, string];

    expect(path).toBe("/home/testuser/.claude/settings.json");
    const written = JSON.parse(content);

    // preserves existing top-level keys
    expect(written.theme).toBe("dark");
    expect(written.plugins).toEqual([]);

    // preset env vars
    for (const [key, value] of Object.entries(PRESET_ENV)) {
      expect(written.env[key]).toBe(value);
    }
    // user input value
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-token-123");

    // confirmation message
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("switched to Claude Code / DeepSeek V4");
    expect(output).toContain("/home/testuser/.claude/settings.json");
  });

  it("creates new settings file when it does not exist", async () => {
    selectMock.mockResolvedValueOnce("claude-code");
    selectMock.mockResolvedValueOnce("deepseek-v4");
    inputMock.mockResolvedValueOnce("sk-token");

    existsSyncMock.mockReturnValue(false);

    await switchPlatform();

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileSyncMock.mock.calls[0] as [string, string];
    const written = JSON.parse(content);

    expect(written.env).toBeDefined();
    expect(written.env.ANTHROPIC_MODEL).toBe("deepseek-v4-pro[1m]");
  });

  it("merges env with priority: inputs > preset > existing file env", async () => {
    selectMock.mockResolvedValueOnce("claude-code");
    selectMock.mockResolvedValueOnce("deepseek-v4");
    inputMock.mockResolvedValueOnce("user-token");

    existsSyncMock.mockReturnValue(true);
    // existing settings has some env vars already set
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        env: {
          ANTHROPIC_MODEL: "existing-model",
          SOME_OTHER_VAR: "keep-me",
        },
      }),
    );

    await switchPlatform();

    const [, content] = writeFileSyncMock.mock.calls[0] as [string, string];
    const written = JSON.parse(content);

    // preset overwrites existing env value
    expect(written.env.ANTHROPIC_MODEL).toBe("deepseek-v4-pro[1m]");
    // unrelated env var is preserved
    expect(written.env.SOME_OTHER_VAR).toBe("keep-me");
    // input value is set
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe("user-token");
  });

  it("skips input collection when model has no inputs config", async () => {
    selectMock.mockResolvedValueOnce("claude-code");
    selectMock.mockResolvedValueOnce("deepseek-v4");
    inputMock.mockResolvedValue("some-token");

    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("{}");

    await switchPlatform();

    // input is called because deepseek-v4 has inputs
    expect(inputMock).toHaveBeenCalledTimes(1);
  });

  it("writes ark-coding-plan preset env vars to settings.json", async () => {
    selectMock.mockResolvedValueOnce("claude-code");
    selectMock.mockResolvedValueOnce("ark-coding-plan");
    inputMock.mockResolvedValueOnce("ark-token-123");

    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ theme: "dark" }),
    );

    await switchPlatform();

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(inputMock).toHaveBeenCalledTimes(1);
    expect(inputMock).toHaveBeenCalledWith({
      message: "Enter your ANTHROPIC_AUTH_TOKEN (ark-xxx)",
      default: "",
    });

    const [, content] = writeFileSyncMock.mock.calls[0] as [string, string];
    const written = JSON.parse(content);

    expect(written.theme).toBe("dark");
    expect(written.env.ANTHROPIC_BASE_URL).toBe("https://ark.cn-beijing.volces.com/api/coding");
    expect(written.env.ANTHROPIC_MODEL).toBe("ark-code-latest");
    expect(written.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("ark-code-latest");
    expect(written.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("ark-code-latest");
    expect(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("ark-code-latest");
    expect(written.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("ark-code-latest");
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe("ark-token-123");

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("switched to Claude Code / Ark Coding Plan");
  });

  it("does not overwrite existing top-level keys unrelated to env", async () => {
    selectMock.mockResolvedValueOnce("claude-code");
    selectMock.mockResolvedValueOnce("deepseek-v4");
    inputMock.mockResolvedValueOnce("sk-token");

    const existing = {
      theme: "light",
      enabledPlugins: { "some-plugin": true },
      hooks: { PreToolUse: [] },
      env: { EXISTING_KEY: "existing-value" },
    };

    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify(existing));

    await switchPlatform();

    const [, content] = writeFileSyncMock.mock.calls[0] as [string, string];
    const written = JSON.parse(content);

    expect(written.theme).toBe("light");
    expect(written.enabledPlugins).toEqual({ "some-plugin": true });
    expect(written.hooks).toEqual({ PreToolUse: [] });
    // existing env preserved
    expect(written.env.EXISTING_KEY).toBe("existing-value");
    // new env added
    expect(written.env.ANTHROPIC_MODEL).toBe("deepseek-v4-pro[1m]");
  });
});
