import type { FullConfig, Reporter } from '@playwright/test/reporter';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig, outputPath, type FrontcoverConfig, type ResolvedConfig } from '../config.js';
import { mergeCoverage } from './merge.js';
import { analyze, type Gap } from '../gaps/analyze.js';
import { diff } from '../gaps/diff.js';
import { terminal, markdown } from '../gaps/render.js';

export default class FrontcoverReporter implements Reporter {
  private config?: ResolvedConfig;
  constructor(private options: { config: FrontcoverConfig }) {}
  async onBegin(config: FullConfig) {
    const rootDir = path.dirname(config.configFile ?? path.join(process.cwd(), 'playwright.config.ts'));
    this.config = resolveConfig(this.options.config, rootDir);
    const raw = path.join(outputPath(this.config), 'raw');
    if (process.env.FRONTCOVER_KEEP !== '1') await fs.rm(raw, { recursive: true, force: true });
    await fs.mkdir(raw, { recursive: true });
  }
  async onEnd() {
    try { await this.finish(); }
    catch (error) {
      console.error(`[frontcover] Coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'failed' as const };
    }
  }
  private async finish() {
    if (!this.config) return;
    const config = this.config;
    const dir = outputPath(config);
    let previous: Gap[] | undefined;
    let previousLines: number | undefined;
    try { previous = JSON.parse(await fs.readFile(path.join(dir, 'gaps.json'), 'utf8')) as Gap[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try {
      previousLines = (JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf8')) as { coveredLines: number }).coveredLines;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const { coverage, files, rawCount, hasCoverage } = await mergeCoverage(config);
    if (!hasCoverage) {
      console.log('\n[frontcover] No browser coverage collected; previous reports and gaps are unchanged. Use Chromium, import test from frontcover, and check test results.');
      return;
    }
    const gaps = await analyze(coverage, files, config.rootDir);
    await fs.writeFile(path.join(dir, 'gaps.json'), JSON.stringify(gaps, null, 2) + '\n');
    await fs.writeFile(path.join(dir, 'gaps.md'), markdown(gaps));
    const counts = Object.values(coverage).flatMap((file) => Object.values(file.s));
    const hit = counts.filter((count) => count > 0).length;
    const coveredLines = Object.values(coverage).reduce((total, file) => {
      const lines = new Set(Object.entries(file.statementMap).filter(([id]) => (file.s[id] ?? 0) > 0).map(([, loc]) => loc.start.line));
      return total + lines.size;
    }, 0);
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify({ coveredLines, statements: { hit, total: counts.length } }, null, 2) + '\n');
    console.log(`\n[frontcover] ${gaps.length} gaps · ${hit}/${counts.length} loaded-code statements reached · ${rawCount} successful test recordings`);
    console.log(terminal(gaps.slice(0, 10)));
    if (previous) {
      const delta = diff(previous, gaps);
      await fs.writeFile(path.join(dir, 'diff.json'), JSON.stringify(delta, null, 2) + '\n');
      const added = previousLines === undefined ? '' : `${coveredLines - previousLines >= 0 ? '+' : ''}${coveredLines - previousLines} lines reached; `;
      console.log(`[frontcover] ${added}${delta.closed.length} gaps closed, ${delta.new.length} new, ${delta.remaining.length} remaining`);
      for (const gap of delta.closed) console.log(`  closed ${gap.id} ${gap.file}:${gap.loc.start.line} ${gap.name ?? gap.kind}`);
    }
    console.log(`[frontcover] Report: ${path.join(dir, 'index.html')}`);
  }
  printsToStdio() { return true; }
}
