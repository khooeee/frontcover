import { test, expect } from 'frontcover';

test('add a todo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New todo' }).fill('Buy milk');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('listitem')).toContainText('Buy milk');
  await expect(page.getByText('1 item left')).toBeVisible();
});
