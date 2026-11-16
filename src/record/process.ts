import { spawn, type SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

export function playwrightCLI(cwd: string): string {
  try { return createRequire(path.join(cwd, 'package.json')).resolve('@playwright/test/cli'); }
  catch { throw new Error('Install @playwright/test in your project: npm install -D @playwright/test'); }
}

export function runProcess(command: string, args: string[], options: SpawnOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}

export function playwright(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return runProcess(process.execPath, [playwrightCLI(cwd), ...args], { cwd, env });
}
