// @ts-check
const { test, expect } = require('@playwright/test');

async function openSampleDb(page) {
  await page.goto('/');
  const sampleRow = page.locator('#explorer-list .explorer-row[data-path="sample.db"]');
  await expect(sampleRow).toBeVisible();
  await sampleRow.click();
  await expect(page.locator('#workspace-file')).toHaveText('sample.db');
}

test('멀티 쿼리 실행 시 result 탭이 생성된다', async ({ page }) => {
  await openSampleDb(page);
  const sqlEditor = page.locator('#sql-editor');
  await expect(sqlEditor).toBeVisible();

  await sqlEditor.fill("SELECT name FROM customers ORDER BY id LIMIT 2;\nSELECT city FROM customers ORDER BY id LIMIT 2;");
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  await expect(page.locator('#query-result .query-multi-tab')).toHaveCount(2);
  await expect(page.locator('#query-result .query-multi-tab.active')).toHaveText('result1');
});

test('그리드 셀 범위 선택이 동작한다', async ({ page }) => {
  await openSampleDb(page);

  const customersTab = page.locator('.tab-button[data-tab="table-0"]');
  await customersTab.click();

  const firstCell = page.locator('#table-result-table-0 td[data-row="0"][data-col="0"]');
  const secondCell = page.locator('#table-result-table-0 td[data-row="1"][data-col="0"]');
  await expect(firstCell).toBeVisible();
  await expect(secondCell).toBeVisible();

  await firstCell.click();
  await secondCell.click({ modifiers: ['Shift'] });

  await expect(page.locator('#table-result-table-0 td.is-selected')).toHaveCount(2);
});

test('탐색기 키보드로 항목 선택이 이동한다', async ({ page }) => {
  await page.goto('/');
  const explorer = page.locator('#explorer-list');
  await expect(explorer).toBeVisible();

  const rows = page.locator('#explorer-list .explorer-row');
  await expect(rows.first()).toBeVisible();

  await explorer.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');

  const selected = page.locator('#explorer-list .explorer-row.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeVisible();

  await page.keyboard.press('Home');
  await expect(page.locator('#explorer-list .explorer-row.selected').first()).toBeVisible();
});

test('단일 쿼리 실행 시 결과 그리드가 렌더링된다', async ({ page }) => {
  await openSampleDb(page);
  const sqlEditor = page.locator('#sql-editor');
  await expect(sqlEditor).toBeVisible();

  await sqlEditor.fill('SELECT name FROM customers ORDER BY id LIMIT 1;');
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  await expect(page.locator('#query-result .result-grid')).toBeVisible();
  await expect(page.locator('#query-result .result-grid td[data-row="0"][data-col="0"]')).toHaveText('Kim Mina');
});

test('Output Auto Hide 토글이 동작한다', async ({ page }) => {
  await page.goto('/');
  const outputPanel = page.locator('.workspace-output');
  const toggleButton = page.locator('#output-autohide');
  await expect(outputPanel).toBeVisible();
  await expect(toggleButton).toBeVisible();

  await toggleButton.click();
  await expect(outputPanel).toHaveClass(/is-collapsed/);

  await toggleButton.click();
  await expect(outputPanel).not.toHaveClass(/is-collapsed/);
});

test('Data Explorer 필터 입력 시 하이라이트가 표시된다', async ({ page }) => {
  await page.goto('/');
  const filter = page.locator('#explorer-filter');
  await expect(filter).toBeVisible();

  await filter.fill('sample');
  await expect(page.locator('#explorer-list mark.explorer-match')).toHaveCount(1);
  await expect(page.locator('#explorer-list .explorer-row')).toContainText(['sample.db']);
});

test('DDL 탭 전환 시 테이블 스키마 섹션이 보인다', async ({ page }) => {
  await openSampleDb(page);
  const ddlTab = page.locator('.tab-button[data-tab="ddl"]');
  await expect(ddlTab).toBeVisible();
  await ddlTab.click();

  await expect(page.locator('#tab-ddl .ddl-section').first()).toBeVisible();
  await expect(page.locator('#tab-ddl')).toContainText('Columns');
  await expect(page.locator('#tab-ddl')).toContainText('Indexes');
});

test('멀티 쿼리 결과 탭을 전환할 수 있다', async ({ page }) => {
  await openSampleDb(page);
  const sqlEditor = page.locator('#sql-editor');
  await expect(sqlEditor).toBeVisible();

  await sqlEditor.fill("SELECT 'A' AS k;\nSELECT 'B' AS k;");
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  const secondTab = page.locator('#query-result .query-multi-tab', { hasText: 'result2' });
  await secondTab.click();

  await expect(page.locator('#query-result .query-multi-tab.active')).toHaveText('result2');
  await expect(page.locator('#query-result .query-multi-panel.active td[data-row="0"][data-col="0"]')).toHaveText('B');
});

test('활동 레일로 Explorer/Chat/Setting 패널 전환이 된다', async ({ page }) => {
  await page.goto('/');

  await page.locator('.rail-button[data-target="chat"]').click();
  await expect(page.locator('.panel-chat')).toHaveClass(/active/);
  await expect(page.locator('.panel-explorer')).not.toHaveClass(/active/);

  await page.locator('.rail-button[data-target="settings"]').click();
  await expect(page.locator('.panel[data-panel="settings"]')).toHaveClass(/active/);
  await expect(page.locator('.panel-chat')).not.toHaveClass(/active/);

  await page.locator('.rail-button[data-target="explorer"]').click();
  await expect(page.locator('.panel-explorer')).toHaveClass(/active/);
});

test('Output 로그에 타임스탬프와 쿼리 시작/종료 로그가 남는다', async ({ page }) => {
  await openSampleDb(page);
  const sqlEditor = page.locator('#sql-editor');
  await sqlEditor.fill('SELECT name FROM customers ORDER BY id LIMIT 1;');
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  const startLine = page.locator('#output-body .output-line', { hasText: 'QUERY START' }).last();
  const endLine = page.locator('#output-body .output-line', { hasText: 'QUERY END' }).last();

  await expect(startLine).toBeVisible();
  await expect(endLine).toBeVisible();
  await expect(startLine).toHaveText(/\d{8} \d{6} QUERY START/);
  await expect(endLine).toHaveText(/\d{8} \d{6} QUERY END/);
});

test('탐색기 Home/End/PageDown 키로 선택이 끝단으로 이동한다', async ({ page }) => {
  await page.goto('/');
  const explorer = page.locator('#explorer-list');
  const rows = page.locator('#explorer-list .explorer-row');
  await expect(explorer).toBeVisible();
  await expect(rows.first()).toBeVisible();

  const rowCount = await rows.count();
  const baseRow = rowCount > 1 ? rows.nth(1) : rows.first();
  const basePath = await baseRow.getAttribute('data-path');
  const firstPath = await rows.first().getAttribute('data-path');

  await baseRow.click();

  await explorer.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-list .explorer-row.selected')).not.toHaveAttribute('data-path', String(basePath || ''));

  await page.keyboard.press('Home');
  await expect(page.locator('#explorer-list .explorer-row.selected')).toHaveAttribute('data-path', String(firstPath || ''));

  await page.keyboard.press('PageDown');
  await expect(page.locator('#explorer-list .explorer-row.selected')).not.toHaveAttribute('data-path', String(firstPath || ''));
});

test('그리드 컨텍스트 메뉴의 Select Row/Clear Selection이 동작한다', async ({ page }) => {
  await openSampleDb(page);

  const customersTab = page.locator('.tab-button[data-tab="table-0"]');
  await customersTab.click();

  const firstCell = page.locator('#table-result-table-0 td[data-row="0"][data-col="0"]');
  await expect(firstCell).toBeVisible();
  await firstCell.click();

  await firstCell.click({ button: 'right' });
  const selectRowMenu = page.locator('.grid-context-menu button[data-action="select-row"]');
  await expect(selectRowMenu).toBeVisible();
  await selectRowMenu.click();

  const colCount = await page.locator('#table-result-table-0 thead th.grid-sortable').count();
  await expect(page.locator('#table-result-table-0 td.is-selected')).toHaveCount(colCount);

  await firstCell.click({ button: 'right' });
  const clearSelectionMenu = page.locator('.grid-context-menu button[data-action="clear-selection"]');
  await expect(clearSelectionMenu).toBeVisible();
  await clearSelectionMenu.click();

  await expect(page.locator('#table-result-table-0 td.is-selected')).toHaveCount(0);
});
