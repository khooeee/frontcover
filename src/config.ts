import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PlaywrightTestOptions } from '@playwright/test';

export interface FrontcoverConfig {
  app: { url: string; command?: string; reset?: string; timeout?: number };
  include?: string[];
  exclude?: string[];
  testDir?: string;
  outputDir?: string;
  storageState?: PlaywrightTestOptions['storageState'];
}

export interface ResolvedConfig extends FrontcoverConfig {
  rootDir: string;
  include: string[];
  exclude: string[];
  testDir: string;
  outputDir: string;
}

export function defineConfig(config: FrontcoverConfig): FrontcoverConfig {
  return config;
}

export function resolveConfig(config: FrontcoverConfig, rootDir = process.cwd()): ResolvedConfig {
  if (!config?.app?.url) throw new Error('frontcover config must define app.url');
  const url = new URL(config.app.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('app.url must use http or https');
  if (config.app.timeout !== undefined && (!Number.isFinite(config.app.timeout) || config.app.timeout <= 0)) {
    throw new Error('app.timeout must be a positive number of milliseconds');
  }
  for (const key of ['include', 'exclude'] as const) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].some((item) => typeof item !== 'string'))) {
      throw new Error(`${key} must be an array of glob patterns`);
    }
  }
  return {
    ...config,
    rootDir: path.resolve(rootDir),
    include: config.include ?? ['src/**/*.{ts,tsx,js,jsx,vue,svelte}'],
    exclude: config.exclude ?? ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
    testDir: config.testDir ?? 'e2e',
    outputDir: config.outputDir ?? '.frontcover',
  };
}

export async function loadConfig(rootDir = process.cwd()): Promise<ResolvedConfig> {
  for (const extension of ['ts', 'js', 'mjs']) {
    const file = path.resolve(rootDir, `frontcover.config.${extension}`);
    try { await fs.access(file); } catch { continue; }
    let module: { default: FrontcoverConfig };
    try { module = await import(pathToFileURL(file).href); }
    catch (error) {
      if (error instanceof SyntaxError && /import|export/.test(error.message)) {
        throw new Error(`Cannot load ${file} as an ES module. In a CommonJS project, use frontcover.config.mjs (plain JavaScript) or set "type": "module".`, { cause: error });
      }
      throw error;
    }
    return resolveConfig(module.default, rootDir);
  }
  throw new Error(`No frontcover.config.{ts,js,mjs} found in ${rootDir}. Run frontcover init.`);
}

export function outputPath(config: ResolvedConfig): string {
  return path.resolve(config.rootDir, config.outputDir);
}
