// @ts-check
const { test, expect } = require('@playwright/test');

async function openSampleDb(page) {
  await page.goto('/');
  const sampleRow = page.locator('#explorer-list .explorer-row[data-path="sample.db"]');
  await expect(sampleRow).toBeVisible();
  await sampleRow.click();
  await expect(page.locator('#workspace-file')).toHaveText('sample.db');
}

test('앱 기본 화면이 로드된다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#explorer-list')).toBeVisible();
});

test('샘플 DB를 열 수 있다', async ({ page }) => {
  await openSampleDb(page);
  await expect(page.locator('.tab-button[data-tab="query"]')).toBeVisible();
});

test('F9로 단일 쿼리를 실행할 수 있다', async ({ page }) => {
  await openSampleDb(page);
  const sqlEditor = page.locator('#sql-editor');
  await expect(sqlEditor).toBeVisible();

  await sqlEditor.fill('SELECT name FROM customers ORDER BY id LIMIT 1;');
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  await expect(page.locator('#query-result .result-grid')).toBeVisible();
  await expect(page.locator('#query-result .result-grid td[data-row="0"][data-col="0"]')).toHaveText('Kim Mina');
});
