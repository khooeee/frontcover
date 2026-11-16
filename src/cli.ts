#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import picomatch from 'picomatch';
import { loadConfig, outputPath, type ResolvedConfig } from './config.js';
import { resetApp, startApp } from './record/app.js';
import { playwright, playwrightCLI, runProcess } from './record/process.js';
import { recordCode } from './record/codegen.js';
import type { Gap } from './gaps/analyze.js';
import { terminal, markdown, json, detail } from './gaps/render.js';

const help = `frontcover — record tests, then find what to record next

  frontcover init
  frontcover record <name> [--url /path] [--gap <id>] [--force]
  frontcover run [playwright test arguments]
  frontcover gaps [<id>] [--json|--md] [--top N] [--file glob]
  frontcover report

Run commands from the directory containing your Playwright and frontcover configs.
Coverage is Chromium-only. Import test and expect from 'frontcover'.`;

async function readGaps(config: ResolvedConfig): Promise<Gap[]> {
  try { return JSON.parse(await fs.readFile(path.join(outputPath(config), 'gaps.json'), 'utf8')) as Gap[]; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('No gaps.json found. Run frontcover run first.');
    throw error;
  }
}

async function init(cwd: string) {
  playwrightCLI(cwd);
  let packageDir = cwd;
  let esm = false;
  while (true) {
    try { esm = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8')).type === 'module'; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(packageDir);
    if (parent === packageDir) break;
    packageDir = parent;
  }
  const frontcoverName = esm ? 'frontcover.config.ts' : 'frontcover.config.mjs';
  const configImport = esm ? 'frontcover.config' : frontcoverName;
  const configs = {
    [frontcoverName]: `import { defineConfig } from 'frontcover';\n\nexport default defineConfig({\n  app: { command: 'npm run dev', url: 'http://localhost:5173' },\n  include: ['src/**/*.{ts,tsx,js,jsx}'],\n  testDir: 'e2e',\n});\n`,
    'playwright.config.ts': `import { defineConfig } from '@playwright/test';\nimport { withFrontcover } from 'frontcover/playwright';\nimport frontcover from './${configImport}';\n\nexport default defineConfig(withFrontcover(frontcover));\n`,
  };
  for (const [name, source] of Object.entries(configs)) {
    // Respect existing config files with any supported extension.
    const stem = name.replace(/\.(?:ts|mjs)$/, '');
    let existing: string | undefined;
    for (const ext of ['ts', 'js', 'mjs', 'cts', 'cjs', 'mts']) {
      const candidate = `${stem}.${ext}`;
      try { await fs.access(path.join(cwd, candidate)); existing = candidate; break; } catch {}
    }
    if (existing) console.log(`${existing} already exists. Merge this setup into it:\n\n${source}`);
    else { await fs.writeFile(path.join(cwd, name), source, { flag: 'wx' }); console.log(`Created ${name}`); }
  }
  const ignoreFile = path.join(cwd, '.gitignore');
  const ignore = await fs.readFile(ignoreFile, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return ''; });
  if (!ignore.split(/\r?\n/).some((line) => /^\/?\.frontcover\/?$/.test(line.trim()))) {
    await fs.appendFile(ignoreFile, `${ignore && !ignore.endsWith('\n') ? '\n' : ''}.frontcover/\n`);
  }
  console.log("Ready. Install Chromium with npx playwright install chromium, then import test from 'frontcover'.");
}

async function record(config: ResolvedConfig, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { url: { type: 'string' }, gap: { type: 'string' }, force: { type: 'boolean' } } });
  const name = positionals[0];
  if (positionals.length !== 1 || !name || !/^[\w][\w-]*$/.test(name)) throw new Error('Use record <name> with letters, digits, underscores, or hyphens.');
  if (values.gap) {
    const gap = (await readGaps(config)).find((gap) => gap.id === values.gap);
    if (!gap) throw new Error(`Unknown gap: ${values.gap}`);
    console.log(detail(gap));
  }
  const dir = path.resolve(config.rootDir, config.testDir);
  const file = path.join(dir, `${name}.spec.ts`);
  if (!values.force) {
    try { await fs.access(file); throw new Error(`${file} already exists; use --force to replace it.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const url = new URL(values.url ?? config.app.url, config.app.url).href;
  await fs.mkdir(dir, { recursive: true });
  // Record to a staging file so a cancellation never destroys an existing spec.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'frontcover-record-'));
  const staging = path.join(temporary, `${name}.spec.ts`);
  let stop: (() => Promise<void>) | undefined;
  try {
    await resetApp(config);
    stop = await startApp(config);
    let recorderConfig = config;
    if (config.storageState && typeof config.storageState !== 'string') {
      const state = path.join(temporary, 'storage-state.json');
      await fs.writeFile(state, JSON.stringify(config.storageState), { mode: 0o600 });
      recorderConfig = { ...config, storageState: state };
    }
    const code = await recordCode(recorderConfig, name, staging, url);
    if (code !== 0) return code;
    await fs.copyFile(staging, file, values.force ? 0 : (await import('node:fs')).constants.COPYFILE_EXCL);
    console.log(`[frontcover] Saved ${file}`);
    await resetApp(config);
    return await playwright(['test', file], config.rootDir, { ...process.env, FRONTCOVER_KEEP: '1' });
  } finally { await stop?.(); await fs.rm(temporary, { recursive: true, force: true }); }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') { console.log(help); return 0; }
  const cwd = process.cwd();
  if (command === 'init') { if (rest.length) throw new Error('init takes no arguments'); await init(cwd); return 0; }
  if (!['record', 'run', 'gaps', 'report'].includes(command)) throw new Error(`Unknown command: ${command}\n\n${help}`);
  const config = await loadConfig(cwd);
  if (command === 'run') { await resetApp(config); return playwright(['test', ...rest], cwd); }
  if (command === 'record') return record(config, rest);
  if (command === 'gaps') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      json: { type: 'boolean' }, md: { type: 'boolean' }, top: { type: 'string' }, file: { type: 'string' },
    } });
    if (values.json && values.md) throw new Error('Choose --json or --md');
    if (positionals.length > 1) throw new Error('gaps accepts at most one gap ID');
    const top = values.top === undefined ? undefined : Number(values.top);
    if (top !== undefined && (!Number.isInteger(top) || top < 1)) throw new Error('--top must be a positive integer');
    let gaps = await readGaps(config);
    if (positionals[0]) {
      const gap = gaps.find((gap) => gap.id === positionals[0]);
      if (!gap) throw new Error(`Unknown gap: ${positionals[0]}`);
      console.log(values.json ? json([gap]) : detail(gap));
      return 0;
    }
    if (values.file) { const matches = picomatch(values.file, { dot: true }); gaps = gaps.filter((gap) => matches(gap.file)); }
    if (top !== undefined) gaps = gaps.slice(0, top);
    console.log(values.json ? json(gaps) : values.md ? markdown(gaps) : terminal(gaps));
    return 0;
  }
  if (rest.length) throw new Error('report takes no arguments');
  const file = path.join(outputPath(config), 'index.html');
  try { await fs.access(file); } catch { throw new Error('No HTML report found. Run frontcover run first.'); }
  if (process.platform === 'darwin') return runProcess('open', [file]);
  if (process.platform === 'win32') return runProcess('cmd', ['/c', 'start', '', file]);
  return runProcess('xdg-open', [file]);
}

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(`[frontcover] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
