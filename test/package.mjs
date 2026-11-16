// Tests an actual tarball installation, avoiding workspace-symlink transforms.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frontcover-package-')));
const run = (command, args, cwd, expected = 0) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  child.once('error', reject);
  child.once('exit', (code) => code === expected ? resolve(output) : reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${output}`)));
});
try {
  await run('npm', ['pack', '--pack-destination', temporary], root);
  const tarball = path.join(temporary, (await fs.readdir(temporary)).find((name) => name.endsWith('.tgz')));
  const consumer = path.join(temporary, 'consumer');
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'commonjs', dependencies: { frontcover: `file:${tarball}`, '@playwright/test': '1.65.1' } }));
  await run('npm', ['install', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], consumer);
  const cli = path.join(consumer, 'node_modules/frontcover/dist/cli.js');
  const pw = path.join(consumer, 'node_modules/@playwright/test/cli.js');
  await run(path.join(consumer, 'node_modules/.bin/frontcover'), ['--help'], consumer);
  await run(process.execPath, [cli, 'init'], consumer);
  assert((await fs.readFile(path.join(consumer, 'playwright.config.ts'), 'utf8')).includes('frontcover.config.mjs'));
  // Tests with no page still exercise fixture loading, ESM exports and the reporter.
  await fs.writeFile(path.join(consumer, 'frontcover.config.mjs'), `import {defineConfig} from 'frontcover';export default defineConfig({app:{url:'http://localhost:5187'},include:[],testDir:'e2e'});`);
  await fs.mkdir(path.join(consumer, 'e2e'));
  await fs.writeFile(path.join(consumer, 'e2e/smoke.spec.ts'), `import {test,expect} from 'frontcover';test('installed ESM fixture',async()=>{expect(1).toBe(1)});`);
  await run(process.execPath, [pw, 'test'], consumer);
  const listing = await run('npm', ['ls', '@playwright/test', '--json'], consumer);
  const dependencies = JSON.parse(listing).dependencies;
  assert.equal(dependencies['@playwright/test'].version, '1.65.1');
  assert.equal(dependencies.frontcover.dependencies['@playwright/test'].version, '1.65.1');
  const consumerRequire = createRequire(path.join(consumer, 'package.json'));
  const frontcoverRequire = createRequire(consumerRequire.resolve('frontcover/package.json'));
  assert.equal(consumerRequire.resolve('@playwright/test/package.json'), frontcoverRequire.resolve('@playwright/test/package.json'));
  const absentGaps = await run(process.execPath, [cli, 'gaps'], consumer, 1);
  assert(absentGaps.includes('No gaps.json'));
  // Switch the same installed package to an ESM consumer and use generated TS configs.
  const pkg = JSON.parse(await fs.readFile(path.join(consumer, 'package.json'), 'utf8'));pkg.type='module';
  await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify(pkg));
  await fs.rm(path.join(consumer, 'frontcover.config.mjs'));await fs.rm(path.join(consumer, 'playwright.config.ts'));
  await run(process.execPath, [cli, 'init'], consumer);
  assert((await fs.readFile(path.join(consumer, 'playwright.config.ts'), 'utf8')).includes("'./frontcover.config'"));
  await fs.writeFile(path.join(consumer, 'frontcover.config.ts'), `import {defineConfig} from 'frontcover';export default defineConfig({app:{url:'http://localhost:5187'},include:[],testDir:'e2e'});`);
  await run(process.execPath, [pw, 'test'], consumer);
  console.log('Verified tarball install, executable, one Playwright version, ESM consumer, and CommonJS Playwright config.');
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
