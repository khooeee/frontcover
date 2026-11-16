import { expect, it } from 'vitest';
import { withFrontcover } from '../src/playwright.js';
import { sourcePathNormalizer } from '../src/coverage/files.js';

it('merges user Playwright settings and appends an absolute reporter', () => {
  const config = withFrontcover({ app: { url: 'http://localhost:5187', command: 'npm run dev' }, testDir: 'e2e' }, {
    reporter: [['dot']], use: { viewport: { width: 800, height: 600 } }, metadata: { owner: 'test' },
  });
  expect(config.testDir).toBe('e2e');
  expect(config.use?.baseURL).toBe('http://localhost:5187');
  expect(config.use?.viewport?.width).toBe(800);
  expect(config.reporter).toHaveLength(2);
  expect(config.metadata?.owner).toBe('test');
  expect((config.reporter as Array<[string]>)[1]![0]).toMatch(/^\//);
});

it('normalizes Vite dev, built source maps, file URLs and duplicate basenames', () => {
  const normalize = sourcePathNormalizer('/repo', ['src/App.tsx', 'src/a/index.ts', 'src/b/index.ts']);
  expect(normalize('App.tsx', { url: 'App.tsx', distFile: 'localhost-5187/src/App.tsx' })).toBe('src/App.tsx');
  expect(normalize('src/App.tsx', { url: '../../src/App.tsx', distFile: 'assets/app.js' })).toBe('src/App.tsx');
  expect(normalize('x', { url: 'file:///repo/src/App.tsx' })).toBe('src/App.tsx');
  expect(normalize('index.ts', { url: 'index.ts', distFile: 'localhost-5187/src/b/index.ts' })).toBe('src/b/index.ts');
  expect(normalize('index.ts', { url: 'index.ts' })).toBe('index.ts');
});
