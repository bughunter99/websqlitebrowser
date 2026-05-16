// @ts-nocheck
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

test('연속 실행 시 이전 쿼리 응답이 최신 결과를 덮어쓰지 않는다', async ({ page }) => {
  let queryRequestCount = 0;
  await page.route('**/api/query/', async (route) => {
    queryRequestCount += 1;

    if (queryRequestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: ['v'],
          rows: [{ v: 'OLD_RESULT' }],
          row_count: 1,
          truncated: false,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        columns: ['v'],
        rows: [{ v: 'NEW_RESULT' }],
        row_count: 1,
        truncated: false,
      }),
    });
  });

  await openSampleDb(page);
  const sqlEditor = page.locator('#sql-editor');
  await expect(sqlEditor).toBeVisible();

  await sqlEditor.fill('SELECT 1;');
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  await sqlEditor.fill('SELECT 2;');
  await sqlEditor.focus();
  await page.keyboard.press('F9');

  await expect(page.locator('#query-result .result-grid td[data-row="0"][data-col="0"]')).toHaveText('NEW_RESULT');
  await expect(page.locator('#query-result .result-grid')).toBeVisible();
  await expect.poll(() => queryRequestCount).toBe(2);
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

test('테이블 탭 재진입 시 데이터 재요청 없이 캐시를 사용한다', async ({ page }) => {
  await openSampleDb(page);

  let customerTableRequestCount = 0;
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/table/?') && url.includes('table=customers')) {
      customerTableRequestCount += 1;
    }
  });

  const customersTab = page.locator('.tab-button[data-tab="table-0"]');
  const queryTab = page.locator('.tab-button[data-tab="query"]');

  await customersTab.click();
  await expect(page.locator('#table-result-table-0 td[data-row="0"][data-col="0"]')).toBeVisible();

  await queryTab.click();
  await expect(page.locator('#query-layout')).toBeVisible();

  await customersTab.click();
  await expect(page.locator('#table-result-table-0 td[data-row="0"][data-col="0"]')).toBeVisible();

  await expect.poll(() => customerTableRequestCount).toBe(1);
});

test('지연된 실패 응답이 최신 테이블 성공 결과를 덮어쓰지 않는다', async ({ page }) => {
  let tableRequestCount = 0;
  await page.route('**/api/table/**', async (route) => {
    const url = route.request().url();
    if (!url.includes('table=customers')) {
      await route.continue();
      return;
    }

    tableRequestCount += 1;
    if (tableRequestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forced stale failure' }),
      });
      return;
    }

    await route.continue();
  });

  await openSampleDb(page);

  const customersTab = page.locator('.tab-button[data-tab="table-0"]');
  const queryTab = page.locator('.tab-button[data-tab="query"]');

  await customersTab.click();
  await queryTab.click();
  await customersTab.click();

  await expect(page.locator('#table-result-table-0 td[data-row="0"][data-col="0"]')).toBeVisible();
  await expect(page.locator('#table-result-table-0')).not.toHaveClass(/error/);
  await expect.poll(() => tableRequestCount).toBe(2);
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

test('연속 전송 시 이전 chat 응답이 최신 응답을 덮어쓰지 않는다', async ({ page }) => {
  let chatRequestCount = 0;
  await page.route('**/api/chat/', async (route) => {
    chatRequestCount += 1;

    const body = route.request().postDataJSON();
    const message = String(body?.message || '');

    if (chatRequestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: `OLD:${message}`,
          suggested_sql: '',
          query_result: null,
          database: { name: 'sample.db' },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: `NEW:${message}`,
        suggested_sql: '',
        query_result: null,
        database: { name: 'sample.db' },
      }),
    });
  });

  await openSampleDb(page);
  await page.locator('.rail-button[data-target="chat"]').click();

  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();

  await input.fill('first');
  await input.focus();
  await page.keyboard.press('Control+Enter');

  await input.fill('second');
  await input.focus();
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('#chat-response')).toContainText('NEW:second');
  await expect(page.locator('#chat-response')).not.toContainText('OLD:first');
  await expect.poll(() => chatRequestCount).toBe(2);
});

test('chat 전송 중에는 중복 요청을 막고 전송 버튼을 복구한다', async ({ page }) => {
  let chatRequestCount = 0;
  await page.route('**/api/chat/', async (route) => {
    chatRequestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: 'ONE:hello',
        suggested_sql: '',
        query_result: null,
        database: { name: 'sample.db' },
      }),
    });
  });

  await openSampleDb(page);
  await page.locator('.rail-button[data-target="chat"]').click();

  const input = page.locator('#chat-input');
  const sendButton = page.locator('#chat-send');
  await expect(input).toBeVisible();

  await input.fill('hello');

  await page.evaluate(() => {
    sendChatMessage();
    sendChatMessage();
  });

  await expect(sendButton).toBeDisabled();
  await expect.poll(() => chatRequestCount).toBe(1);
  await expect(page.locator('#chat-response')).toContainText('ONE:hello');
  await expect(sendButton).toBeEnabled();
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

test('Query 패널의 split과 하이라이트 영역이 로드된다', async ({ page }) => {
  await openSampleDb(page);

  await expect(page.locator('#query-layout')).toBeVisible();
  await expect(page.locator('#query-splitter')).toBeVisible();
  await expect(page.locator('#sql-highlight')).toBeVisible();
  await expect(page.locator('#sql-editor')).toBeVisible();
});

test('쿼리 실행 중에는 중복 요청을 막고 에디터를 복구한다', async ({ page }) => {
  await openSampleDb(page);

  const editor = page.locator('#sql-editor');
  await expect(editor).toBeVisible();

  // 브라우저 내부 fetch 패치: /api/query 요청 수 카운팅 + 200ms 지연
  await page.evaluate(() => {
    const orig = window.fetch;
    window.__queryCount = 0;
    window.fetch = async function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
      if (url.includes('/api/query')) {
        window.__queryCount++;
        await new Promise((r) => setTimeout(r, 200));
      }
      return orig.apply(this, args);
    };
  });

  await page.evaluate(() => {
    runQuery();
    runQuery();
  });

  await expect(editor).toHaveAttribute('readonly', '');

  // readonly 해제 대기 (finally 복구 확인)
  await expect(editor).not.toHaveAttribute('readonly', '', { timeout: 10000 });

  const count = await page.evaluate(() => window.__queryCount);
  expect(count).toBe(1);
});

test('쿼리 API가 invalid JSON을 반환해도 에디터 pending이 복구된다', async ({ page }) => {
  await openSampleDb(page);

  await page.route('**/api/query*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'NOT_JSON{{{{',
    });
  });

  const editor = page.locator('#sql-editor');
  await expect(editor).toBeVisible();

  await page.evaluate(() => runQuery());

  // pending이 복구되어 readOnly가 해제되어야 한다
  await expect(editor).not.toHaveAttribute('readonly', '', { timeout: 5000 });
});
