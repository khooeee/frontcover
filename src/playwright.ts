import { fileURLToPath } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';
import { resolveConfig, type FrontcoverConfig } from './config.js';

/** Paths are relative to the directory containing playwright.config, as in Playwright. */
export function withFrontcover(frontcover: FrontcoverConfig, playwright: PlaywrightTestConfig = {}): PlaywrightTestConfig {
  resolveConfig(frontcover); // Validate now; the reporter resolves paths using Playwright's configFile.
  const reporter = fileURLToPath(new URL('./coverage/reporter.js', import.meta.url));
  const existing = playwright.reporter;
  const reporters = typeof existing === 'string' ? [[existing] as [string]] : existing ?? [['list'] as [string]];
  return {
    ...playwright,
    testDir: playwright.testDir ?? frontcover.testDir ?? 'e2e',
    webServer: playwright.webServer ?? (frontcover.app.command ? {
      command: frontcover.app.command,
      url: frontcover.app.url,
      timeout: frontcover.app.timeout ?? 60_000,
      reuseExistingServer: !process.env.CI,
    } : undefined),
    use: {
      baseURL: frontcover.app.url,
      ...(frontcover.storageState !== undefined ? { storageState: frontcover.storageState } : {}),
      ...playwright.use,
    },
    metadata: { ...playwright.metadata, frontcover },
    reporter: [...reporters, [reporter, { config: frontcover }]],
  };
}
