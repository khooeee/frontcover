import { test as base, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { V8CoverageEntry } from 'monocart-coverage-reports';
import { resolveConfig, outputPath, type FrontcoverConfig } from '../config.js';

// Capture external maps while the app is still running. Inline maps stay in source.
async function sourceMaps(entries: V8CoverageEntry[], page: Page): Promise<void> {
  await Promise.all(entries.map(async (entry) => {
    const match = /[#@]\s*sourceMappingURL=([^\s]+)/g;
    const refs = [...(entry.source ?? '').matchAll(match)];
    const ref = refs.at(-1)?.[1];
    if (!ref || ref.startsWith('data:')) return;
    try {
      const response = await page.request.get(new URL(ref, entry.url).href, { timeout: 5000 });
      if (response.ok()) entry.sourceMap = await response.json();
    } catch { /* monocart can still use the generated source when a map is unavailable */ }
  }));
}

export const test = base.extend<{ _frontcover: void }>({
  _frontcover: [async ({ context, browserName }, use, testInfo) => {
    const config = testInfo.config.metadata.frontcover as FrontcoverConfig | undefined;
    if (browserName !== 'chromium' || !config) { await use(); return; }
    const rootDir = path.dirname(testInfo.config.configFile ?? path.join(process.cwd(), 'playwright.config.ts'));
    const resolved = resolveConfig(config, rootDir);
    const starts = new Map<Page, Promise<void>>();
    const entries: V8CoverageEntry[] = [];
    const stopped = new Set<Page>();
    const failures: string[] = [];
    const stop = async (page: Page) => {
      if (stopped.has(page)) return;
      stopped.add(page);
      await starts.get(page);
      if (page.isClosed()) { failures.push('A page closed before its coverage could be collected.'); return; }
      try {
        const data = await page.coverage.stopJSCoverage();
        await sourceMaps(data, page);
        entries.push(...data);
      } catch (error) { failures.push(String(error)); }
    };
    const start = (page: Page) => {
      if (starts.has(page)) return;
      starts.set(page, page.coverage.startJSCoverage({ resetOnNavigation: false }).catch((error) => { failures.push(String(error)); }));
      // Explicit page.close() is common for popups. Collect before it destroys V8's data.
      const close = page.close.bind(page);
      page.close = async (options) => { await stop(page); await close(options); };
    };
    context.on('page', start);
    for (const page of context.pages()) start(page);
    try { await use(); } finally {
      context.off('page', start);
      await Promise.all([...starts.keys()].map(stop));
      if (failures.length) console.warn(`[frontcover] ${[...new Set(failures)].join('\n')}`);
      if (testInfo.status === testInfo.expectedStatus && testInfo.status !== 'skipped') {
        const dir = path.join(outputPath(resolved), 'raw');
        await fs.mkdir(dir, { recursive: true });
        const id = createHash('sha256').update(testInfo.testId).digest('hex').slice(0, 16);
        await fs.writeFile(path.join(dir, `${id}-${testInfo.retry}-${randomUUID()}.json`), JSON.stringify(entries));
      }
    }
  }, { auto: true }],
});

export { expect };
