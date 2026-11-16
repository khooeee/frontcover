// Run from any directory: node spike/spike.mjs dev|preview [port]
import { chromium } from '@playwright/test';
import { CoverageReport } from 'monocart-coverage-reports';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? 'dev';
if (!['dev', 'preview'].includes(mode)) throw new Error('Use dev or preview');
const port = Number(process.argv[3] ?? (mode === 'dev' ? 5187 : 4187));
const appDir = fileURLToPath(new URL('../examples/todo-app/', import.meta.url));
const outputDir = path.join(appDir, '.frontcover', `spike-${mode}`);
const url = `http://localhost:${port}`;
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const exec = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [vite, ...args], { cwd: appDir, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`vite exited ${code}`)));
});
if (mode === 'preview') await exec(['build', '--sourcemap']);
const files = (await fs.readdir(path.join(appDir, 'src'), { recursive: true }))
  .filter((file) => /\.[jt]sx?$/.test(file)).map((file) => `src/${file}`);
const trace = [];
function sourcePath(input, info) {
  let original = info.url ?? input;
  try { original = new URL(original).pathname; } catch {}
  original = decodeURIComponent(original).replace(/\\/g, '/').split(/[?#]/)[0];
  const dist = input.replace(/^localhost-\d+\//, '');
  const candidates = [original, input, path.posix.join(path.posix.dirname(info.distFile ?? dist), original)];
  const matches = files.filter((file) => candidates.some((candidate) => candidate === file || candidate.endsWith(`/${file}`)));
  const result = matches.length === 1 ? matches[0] : dist;
  trace.push({ input, url: info.url, distFile: info.distFile, result });
  return result;
}
const server = spawn(process.execPath, [vite, ...(mode === 'preview' ? ['preview'] : []), '--port', String(port), '--strictPort'], {
  cwd: appDir, stdio: 'inherit', detached: process.platform !== 'win32',
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Server did not become ready at ${url}`);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto(url);
  await page.getByLabel('New todo').fill('Buy milk');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('1 item left').waitFor();
  const entries = await page.coverage.stopJSCoverage();
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'raw.json'), JSON.stringify(entries));
  const report = new CoverageReport({
    name: `frontcover spike (${mode})`, outputDir, baseDir: appDir,
    reports: ['json', 'v8'], clean: false, cleanCache: true,
    entryFilter: (entry) => !entry.url.includes('/node_modules/') && !entry.url.includes('/@'),
    sourcePath,
    sourceFilter: (file) => files.includes(file),
    outputFilter: (entry) => files.includes(entry.sourcePath),
  });
  await report.add(entries);
  await report.generate();
  const coverage = JSON.parse(await fs.readFile(path.join(outputDir, 'coverage-final.json'), 'utf8'));
  const summary = Object.entries(coverage).map(([file, data]) => ({
    file,
    functions: Object.entries(data.fnMap).map(([id, fn]) => ({ name: fn.name, line: fn.loc.start.line, count: data.f[id] })),
    branches: Object.entries(data.branchMap).map(([id, branch]) => ({ ...branch, counts: data.b[id] })),
  }));
  await fs.writeFile(path.join(outputDir, 'inspection.json'), JSON.stringify({ trace, summary }, null, 2));
  const app = coverage['src/App.tsx'];
  if (!app || !Object.values(app.fnMap).some((fn) => fn.decl.start.line === 42) || !Object.values(app.branchMap).some((branch) => branch.loc.start.line === 25)) {
    throw new Error('Missing original paths, function names, or validation branch');
  }
  console.log(`${mode}: verified ${Object.keys(coverage).join(', ')}; source function locations and branch locations/counts available`);
  console.log(`Details: ${path.join(outputDir, 'inspection.json')}`);
} finally {
  await browser?.close();
  try { process.platform === 'win32' ? server.kill() : process.kill(-server.pid, 'SIGTERM'); } catch {}
}
