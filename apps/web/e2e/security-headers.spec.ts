import { expect, test } from '@playwright/test';

test.describe('security headers', () => {
  test('pages carry a Content-Security-Policy and load without violating it', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) violations.push(message.text());
    });

    const response = await page.goto('/login');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');

    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await page.goto('/register');
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    expect(violations).toEqual([]);
  });
});
