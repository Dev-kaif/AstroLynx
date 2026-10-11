import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface LockOwner {
  pid: number;
  hostname: string;
  token: string;
  acquiredAt: string;
}

/** Acquire an exclusive local-filesystem lock. Stale locks are deliberately never reclaimed. */
export async function acquireFileLock(
  lockPath: string,
  waitMs = 30_000
): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const owner: LockOwner = {
    pid: process.pid,
    hostname: os.hostname(),
    token,
    acquiredAt: new Date().toISOString(),
  };
  const deadline = Date.now() + waitMs;

  while (true) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      break;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (handle) await fs.rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      if (Date.now() >= deadline) {
        const details = await fs.readFile(lockPath, "utf8").catch(() => "unreadable owner record");
        throw new Error(
          `Timed out waiting for lock ${lockPath}; owner: ${details.trim()}. Confirm the owner process is stopped before removing this lock.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 75 + Math.floor(Math.random() * 75)));
    }
  }

  return async () => {
    let current: LockOwner | null = null;
    try {
      current = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockOwner;
    } catch {
      throw new Error(`Unable to verify lock ownership before release: ${lockPath}`);
    }
    if (current.token !== token) {
      throw new Error(`Lock ownership changed unexpectedly: ${lockPath}`);
    }
    await fs.unlink(lockPath);
  };
}
