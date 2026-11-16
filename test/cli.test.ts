// The recorder is stubbed here; real browser coverage is exercised by test/e2e.mjs.
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const cli = path.resolve('dist/cli.js');
function invoke(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (data) => { output += String(data); });
    child.stderr.on('data', (data) => { output += String(data); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
  });
}

async function project() {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frontcover-cli-')));
  const pkg = path.join(cwd, 'node_modules/@playwright/test');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(pkg, 'package.json'), '{"type":"module","exports":{"./cli":"./cli.mjs"}}');
  await fs.writeFile(path.join(pkg, 'cli.mjs'), `
    import fs from 'node:fs/promises';
    const args = process.argv.slice(2);
    let calls = JSON.parse(await fs.readFile('calls.json', 'utf8').catch(() => '[]'));
    calls.push({args, keep:process.env.FRONTCOVER_KEEP});
    await fs.writeFile('calls.json', JSON.stringify(calls));
    if(args[0] === 'codegen') {
      if(process.env.STUB_CANCEL) process.exit(130);
      const state = JSON.parse(await fs.readFile(args[args.indexOf('--load-storage')+1], 'utf8'));
      if(!Array.isArray(state.origins)) throw Error('Missing storage state');
      await fs.writeFile(args[args.indexOf('-o')+1], "import { test, expect } from '@playwright/test';\\ntest('test', async ({page}) => { await page.goto('" + args.at(-1) + "'); });\\n");
    }
    if(args[0] === 'test') process.exit(Number(process.env.STUB_EXIT ?? 0));
  `);
  await fs.writeFile(path.join(cwd, 'reset.mjs'), `import fs from 'node:fs/promises';const count=Number(await fs.readFile('resets','utf8').catch(()=>'0'));await fs.writeFile('resets',String(count+1));`);
  return cwd;
}

it('records with storage state, rewrites the spec, resets twice, replays with KEEP, and protects existing files', async () => {
  const cwd = await project();
  const server = http.createServer((_request, response) => response.end('ready'));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const config = { app: { url, command: 'this must not run because the server is already up', reset: `${JSON.stringify(process.execPath)} reset.mjs` }, storageState: { cookies: [], origins: [] } };
    await fs.writeFile(path.join(cwd, 'frontcover.config.mjs'), `export default ${JSON.stringify(config)};`);
    const result = await invoke(cwd, ['record', 'validation', '--url', '/form']);
    expect(result.code, result.output).toBe(0);
    expect(await fs.readFile(path.join(cwd, 'resets'), 'utf8')).toBe('2');
    const file = path.join(cwd, 'e2e/validation.spec.ts');
    const source = await fs.readFile(file, 'utf8');
    expect(source).toContain("from 'frontcover'");
    expect(source).toContain('test("validation",');
    expect(source).toContain('page.goto("/form")');
    const calls = JSON.parse(await fs.readFile(path.join(cwd, 'calls.json'), 'utf8'));
    expect(calls[0].args.slice(0, 3)).toEqual(['codegen', '--target', 'playwright-test']);
    expect(calls[1]).toEqual({ args: ['test', file], keep: '1' });
    expect((await invoke(cwd, ['record', 'validation'])).code).toBe(1);
    expect(await fs.readFile(path.join(cwd, 'resets'), 'utf8')).toBe('2');
    expect((await invoke(cwd, ['record', 'validation', '--force'], { STUB_CANCEL: '1' })).code).toBe(130);
    expect(await fs.readFile(file, 'utf8')).toBe(source);
    expect(server.listening).toBe(true); // Reused servers are never stopped.
    const run = await invoke(cwd, ['run', '--project', 'chromium', '--grep', 'with spaces'], { STUB_EXIT: '7' });
    expect(run.code).toBe(7);
    const latest = JSON.parse(await fs.readFile(path.join(cwd, 'calls.json'), 'utf8')).at(-1);
    expect(latest.args).toEqual(['test', '--project', 'chromium', '--grep', 'with spaces']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await fs.rm(cwd, { recursive: true, force: true }); }
}, 15_000);

it('initializes without overwriting configs and adds gitignore once, including CommonJS setup', async () => {
  const cwd = await project();
  try {
    await fs.writeFile(path.join(cwd, 'package.json'), '{"type":"commonjs"}');
    expect((await invoke(cwd, ['init'])).code).toBe(0);
    const source = await fs.readFile(path.join(cwd, 'frontcover.config.mjs'), 'utf8');
    expect(source).toContain('defineConfig');
    const pw = await fs.readFile(path.join(cwd, 'playwright.config.ts'), 'utf8');
    expect(pw).toContain("'./frontcover.config.mjs'");
    await fs.writeFile(path.join(cwd, 'frontcover.config.mjs'), '// user config');
    const second = await invoke(cwd, ['init']);
    expect(second.code).toBe(0);
    expect(second.output).toContain('already exists');
    expect(await fs.readFile(path.join(cwd, 'frontcover.config.mjs'), 'utf8')).toBe('// user config');
    expect(await fs.readFile(path.join(cwd, '.gitignore'), 'utf8')).toBe('.frontcover/\n');
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});
