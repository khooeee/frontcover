import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { ResolvedConfig } from '../config.js';
import { runProcess } from './process.js';

export async function resetApp(config: ResolvedConfig): Promise<void> {
  if (!config.app.reset) return;
  console.log('[frontcover] Resetting app…');
  const code = await runProcess(config.app.reset, [], { cwd: config.rootDir, shell: true });
  if (code !== 0) throw new Error(`app.reset exited with code ${code}`);
}

async function isUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    await response.body?.cancel();
    return response.ok || [400, 401, 402, 403].includes(response.status);
  } catch { return false; }
}

/** Returns a cleanup function that only stops the server started by this call. */
export async function startApp(config: ResolvedConfig): Promise<() => Promise<void>> {
  if (await isUp(config.app.url)) return async () => {};
  if (!config.app.command) throw new Error(`App is not reachable at ${config.app.url}; set app.command or start it yourself.`);
  const child = spawn(config.app.command, [], {
    cwd: config.rootDir, shell: true, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  let error: Error | undefined;
  child.on('error', (cause) => { error = cause; });
  let stopped = false;
  const stop = async () => {
    if (stopped || !child.pid) return;
    stopped = true;
    if (process.platform === 'win32') {
      await runProcess('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } else {
      const kill = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; } };
      kill('SIGTERM');
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try { process.kill(-child.pid, 0); } catch { return; }
        await delay(50);
      }
      kill('SIGKILL');
    }
  };
  try {
    const deadline = Date.now() + (config.app.timeout ?? 60_000);
    while (Date.now() < deadline) {
      if (error) throw error;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`app.command exited before ${config.app.url} was ready`);
      if (await isUp(config.app.url)) return stop;
      await delay(200);
    }
    throw new Error(`App did not become ready at ${config.app.url} within ${config.app.timeout ?? 60_000}ms`);
  } catch (cause) { await stop(); throw cause; }
}
