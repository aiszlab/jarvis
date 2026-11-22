import spawn from "@npmcli/promise-spawn";
import os from "node:os";

/**
 * @zh 保持机器不休眠，直到 Ctrl+C 中断
 *
 * - 前台启动 `caffeinate -d -i -u`：
 *   - `-d` 阻止屏幕熄灭
 *   - `-i` 阻止系统空闲休眠
 *   - `-u` 声明用户活跃（点亮屏幕）
 * - 注意：caffeinate 无法阻止合盖（clamshell）休眠
 * - Ctrl+C 向整个前台进程组发送 SIGINT，caffeinate 与本进程同时退出，
 *   恢复正常的休眠行为
 *
 * @en keep the machine awake until interrupted (Ctrl+C)
 *
 * - spawns `caffeinate -d -i -u` in the foreground:
 *   - `-d` prevents display sleep
 *   - `-i` prevents idle system sleep
 *   - `-u` declares the user active (turns the display on)
 * - note: caffeinate cannot prevent lid-close (clamshell) sleep.
 * - Ctrl+C sends SIGINT to the whole foreground process group, so both
 *   caffeinate and this process exit and normal sleep behavior returns.
 *
 * usage: `jrv unsleep` (macOS only)
 */
export async function unsleep(): Promise<void> {
  if (os.platform() !== "darwin") {
    console.error("unsleep only works on macOS (requires caffeinate)");
    process.exit(1);
  }

  try {
    await spawn("caffeinate", ["-d", "-i", "-u"], { stdio: "inherit" });
  } catch (err) {
    // promise-spawn rejects with signal "SIGINT" when Ctrl+C kills caffeinate
    if ((err as { signal?: string }).signal === "SIGINT") return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`caffeinate failed: ${message}`);
    process.exit(1);
  }
}
