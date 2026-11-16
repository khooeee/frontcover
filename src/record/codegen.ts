import fs from 'node:fs/promises';
import path from 'node:path';
import { playwright } from './process.js';
import type { ResolvedConfig } from '../config.js';

/** Only rewrite generated code patterns; URLs on other origins stay absolute. */
export function postProcess(source: string, name: string, baseURL: string): string {
  let result = source.replace(/(from\s*['"])@playwright\/test(['"])/g, '$1frontcover$2');
  let index = 0;
  result = result.replace(/\btest\((['"])(?:\\.|(?!\1).)*\1\s*,/g, () => `test(${JSON.stringify(index++ ? `${name} (${index})` : name)},`);
  const base = new URL(baseURL);
  result = result.replace(/(\b(?:page|popup\d*|page\d+)\.goto\(\s*)(['"])(https?:\/\/[^'"\n]+)\2/g, (match, prefix: string, _quote: string, value: string) => {
    let url: URL;
    try { url = new URL(value); } catch { return match; }
    return url.origin === base.origin ? `${prefix}${JSON.stringify(url.pathname + url.search + url.hash)}` : match;
  });
  return result;
}

export async function recordCode(config: ResolvedConfig, name: string, file: string, url: string): Promise<number> {
  const args = ['codegen', '--target', 'playwright-test', '-o', file];
  if (typeof config.storageState === 'string') args.push('--load-storage', path.resolve(config.rootDir, config.storageState));
  else if (config.storageState) {
    // CLI only accepts a filename. The caller supplies a temporary file when needed.
    throw new Error('Recorder storageState must be a filename. Save the state to JSON and use that path.');
  }
  args.push(url);
  const code = await playwright(args, config.rootDir);
  if (code !== 0) return code;
  const source = await fs.readFile(file, 'utf8').catch(() => '');
  if (!/\btest\(/.test(source)) throw new Error('Codegen did not write a test. Record some actions before closing the browser.');
  await fs.writeFile(file, postProcess(source, name, config.app.url));
  return 0;
}
