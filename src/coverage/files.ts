import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import type { ResolvedConfig } from '../config.js';

export function matchesSource(config: ResolvedConfig): (file: string) => boolean {
  const include = picomatch(config.include, { dot: true });
  const exclude = picomatch(config.exclude, { dot: true });
  return (file) => include(file) && !exclude(file);
}

export async function sourceFiles(config: ResolvedConfig): Promise<string[]> {
  const matches = matchesSource(config);
  const files: string[] = [];
  const output = path.resolve(config.rootDir, config.outputDir);
  async function walk(dir: string) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (full === output || item.name === 'node_modules' || item.name === '.git') continue;
      if (item.isDirectory()) await walk(full);
      else if (item.isFile()) {
        const file = path.relative(config.rootDir, full).split(path.sep).join('/');
        if (matches(file)) files.push(file);
      }
    }
  }
  await walk(config.rootDir);
  return files.sort();
}

/** Match map URLs against real source paths; never guess from a basename alone. */
export function sourcePathNormalizer(rootDir: string, files: string[]) {
  return (input: string, info: { url?: string; distFile?: string } = {}): string => {
    let original = info.url ?? input;
    try { original = new URL(original).pathname; } catch {}
    try { original = decodeURIComponent(original); } catch {}
    original = original.replace(/\\/g, '/').split(/[?#]/)[0]!;
    const fromRoot = path.isAbsolute(original) ? path.relative(rootDir, original).split(path.sep).join('/') : original;
    const candidates = [original, fromRoot, input, path.posix.join(path.posix.dirname(info.distFile ?? input), original)];
    const matches = files.filter((file) => candidates.some((candidate) => candidate === file || candidate.endsWith(`/${file}`)));
    return matches.length === 1 ? matches[0]! : input;
  };
}
