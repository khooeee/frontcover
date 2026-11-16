import { expect, it } from 'vitest';
import { postProcess } from '../src/record/codegen.js';
it('rewrites recorded imports, titles, and same-origin navigation without changing other URLs', () => {
  const source = `import { test, expect } from '@playwright/test';\ntest('test', async ({ page }) => {\n await page.goto('http://localhost:5173/todos?q=1#new');\n await page.goto('https://example.com/');\n await page.getByText('http://localhost:5173').click();\n});`;
  const result = postProcess(source, 'add-todo', 'http://localhost:5173');
  expect(result).toContain("from 'frontcover'");
  expect(result).toContain('test("add-todo",');
  expect(result).toContain('page.goto("/todos?q=1#new")');
  expect(result).toContain("page.goto('https://example.com/')");
  expect(result).toContain("getByText('http://localhost:5173')");
});
