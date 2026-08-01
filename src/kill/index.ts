import { input } from "@inquirer/prompts";
import spawn from "@npmcli/promise-spawn";
import os from "node:os";

/**
 * @description
 * find the PIDs of processes listening on the given port
 *
 * - on macOS/linux uses `lsof -ti :<port>`
 * - on windows parses `LISTENING` rows from `netstat -ano`
 *
 * returns an empty array when no process is bound to the port
 */
export async function findPidsByPort(port: number): Promise<number[]> {
  if (os.platform() === "win32") {
    const stdout: string = (
      await spawn("netstat", ["-ano"], { stdio: "pipe" })
    ).stdout;
    const pids = new Set<number>();

    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;

      // columns: Proto | Local Address | Foreign Address | State | PID
      const parts = line.trim().split(/\s+/);
      const local = parts[1] ?? "";
      const pid = Number(parts[parts.length - 1]);

      // match only when the local address ends with `:<port>` so that
      // querying :80 does not accidentally match :8080
      if (local.endsWith(`:${port}`) && Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }

    return [...pids];
  }

  try {
    const stdout: string = (
      await spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
    ).stdout;
    return stdout
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // lsof exits non-zero when no process matches the port
    return [];
  }
}

/**
 * @description
 * kill every process listening on the given port (SIGKILL)
 */
export async function killPort(port: number): Promise<void> {
  const pids = await findPidsByPort(port);

  if (pids.length === 0) {
    console.log(`no process found on port ${port}`);
    return;
  }

  for (const pid of pids) {
    process.kill(pid, "SIGKILL");
    console.log(`killed process ${pid} on port ${port}`);
  }
}

/**
 * @description
 * kill the process bound to a port
 *
 * usage: `jrv kill 8080` or `jrv kill` (interactive prompt)
 */
export async function kill(port?: number): Promise<void> {
  const resolved =
    port ?? Number(await input({ message: "Enter port number" }));

  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 65535) {
    console.error("port must be an integer in 0..65535");
    return;
  }

  await killPort(resolved);
}
