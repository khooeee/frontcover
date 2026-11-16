// Exercises the real CLI/Playwright/browser pipeline; requires installed Chromium.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.join(root, 'examples/todo-app');
const cli = path.join(root, 'dist/cli.js');
const output = path.join(app, '.frontcover');
const env = { ...process.env, FRONTCOVER_EXAMPLE_PORT: process.env.FRONTCOVER_EXAMPLE_PORT ?? '5187', FRONTCOVER_KEEP: '' };
const run = (args, overrides = {}, expected = 0) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd: app, env: { ...env, ...overrides }, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => code === expected ? resolve() : reject(new Error(`frontcover ${args.join(' ')} exited ${code}, expected ${expected}`)));
});
const read = async (name) => JSON.parse(await fs.readFile(path.join(output, name), 'utf8'));
const deleted = path.join(app, 'e2e/frontcover-delete.check.spec.ts');
const lifecycle = path.join(app, 'e2e/frontcover-lifecycle.check.spec.ts');
let createdDelete = false;
let createdLifecycle = false;
try {
  await run(['run', 'e2e/add-todo.spec.ts']);
  const gaps = await read('gaps.json');
  assert(gaps.some((g) => g.kind === 'file' && g.file === 'src/pages/Settings.tsx'));
  assert(!gaps.some((g) => g.file === 'src/types.ts'));
  for (const name of ['deleteTodo', 'renameTodo']) assert(gaps.some((g) => g.kind === 'function' && g.name === name));
  assert(gaps.some((g) => g.kind === 'branch' && g.inside === 'addTodo' && /Enter a title first/.test(g.snippet)));
  assert(!gaps.some((g) => g.kind === 'function' && g.name === 'addTodo'));
  const coverage = await read('coverage-final.json');
  assert(Object.keys(coverage).every((file) => file.startsWith('src/')));
  assert((await fs.stat(path.join(output, 'index.html'))).size > 500);
  assert.equal((await fs.readdir(path.join(output, 'raw'))).length, 1);

  await fs.writeFile(deleted, `import { test, expect } from 'frontcover';
  test('delete a todo', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('New todo').fill('Delete me');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(0);
  });\n`, { flag: 'wx' });
  createdDelete = true;
  await run(['run', 'e2e/frontcover-delete.check.spec.ts'], { FRONTCOVER_KEEP: '1' });
  const delta = await read('diff.json');
  assert(delta.closed.some((g) => g.name === 'deleteTodo'));
  assert(!(await read('gaps.json')).some((g) => g.name === 'deleteTodo'));
  assert.equal((await fs.readdir(path.join(output, 'raw'))).length, 2);
  await fs.mkdir(path.join(output, 'verification'), { recursive: true });
  await fs.writeFile(path.join(output, 'verification/delete-diff.json'), JSON.stringify(delta, null, 2));

  await fs.writeFile(lifecycle, `import { test, expect } from 'frontcover';
  test('popup and a second page', async ({ page, context }) => {
    await page.goto('/');
    const opened = page.waitForEvent('popup');
    await page.evaluate(() => window.open('/'));
    const popup = await opened;
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(popup.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await popup.close();
    const second = await context.newPage();
    await second.goto('/');
    await second.getByLabel('New todo').fill('Second page');
    await second.getByRole('button', { name: 'Add', exact: true }).click();
    await second.close();
  });
  test('unexpected failure is discarded', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect(false).toBe(true);
  });\n`, { flag: 'wx' });
  createdLifecycle = true;
  await run(['run', 'e2e/frontcover-lifecycle.check.spec.ts', '--grep', 'popup and a second page']);
  assert((await read('coverage-final.json'))['src/pages/Settings.tsx'], 'popup coverage includes lazy Settings');
  assert.equal((await fs.readdir(path.join(output, 'raw'))).length, 1);
  const beforeFailure = await fs.readFile(path.join(output, 'gaps.json'), 'utf8');
  await run(['run', 'e2e/frontcover-lifecycle.check.spec.ts', '--grep', 'unexpected failure'], {}, 1);
  assert.equal((await fs.readdir(path.join(output, 'raw'))).length, 0, 'failed test raw coverage must be discarded');
  assert.equal(await fs.readFile(path.join(output, 'gaps.json'), 'utf8'), beforeFailure, 'failed runs preserve previous gaps');
  console.log('\nVerified known gaps, delete gap closure, retained raw data, popup/second-page coverage, and failed-test exclusion.');
} finally {
  if (createdDelete) await fs.rm(deleted, { force: true });
  if (createdLifecycle) await fs.rm(lifecycle, { force: true });
}
