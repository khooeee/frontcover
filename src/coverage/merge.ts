import fs from 'node:fs/promises';
import path from 'node:path';
import { CoverageReport, type V8CoverageEntry } from 'monocart-coverage-reports';
import { outputPath, type ResolvedConfig } from '../config.js';
import type { CoverageMap } from '../gaps/analyze.js';
import { sourceFiles, sourcePathNormalizer, matchesSource } from './files.js';

export async function mergeCoverage(config: ResolvedConfig): Promise<{ coverage: CoverageMap; files: string[]; rawCount: number; hasCoverage: boolean }> {
  const dir = outputPath(config);
  const rawDir = path.join(dir, 'raw');
  const files = await sourceFiles(config);
  const rawFiles = (await fs.readdir(rawDir).catch(() => [] as string[])).filter((file) => file.endsWith('.json')).sort();
  const matches = matchesSource(config);
  const report = new CoverageReport({
    name: 'frontcover', outputDir: dir, baseDir: config.rootDir,
    reports: ['json', 'v8', 'lcovonly'], logging: 'off', clean: false, cleanCache: true,
    // Do not filter entry bundles: they may contain app code and third-party code together.
    sourcePath: sourcePathNormalizer(config.rootDir, files),
    sourceFilter: matches,
    outputFilter: (entry) => matches(entry.sourcePath),
  });
  for (const file of rawFiles) {
    const entries = JSON.parse(await fs.readFile(path.join(rawDir, file), 'utf8')) as V8CoverageEntry[];
    if (entries.length) await report.add(entries);
  }
  // monocart deliberately doesn't invent coverage for unloaded files. The analyzer finds them.
  if (report.hasCache()) {
    await report.generate();
  } else {
    return { coverage: {}, files, rawCount: rawFiles.length, hasCoverage: false };
  }
  const coverage = JSON.parse(await fs.readFile(path.join(dir, 'coverage-final.json'), 'utf8')) as CoverageMap;
  return { coverage, files, rawCount: rawFiles.length, hasCoverage: true };
}
