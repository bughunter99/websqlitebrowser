/**
 * app.query.js - Query Execution
 * SQL 실행 및 결과 렌더링
 */

/** @typedef {{ [key: string]: unknown }} QueryRow */
/** @typedef {{ columns?: string[], rows?: QueryRow[], row_count?: number, truncated?: boolean, statement_index?: number }} QueryResult */
/** @typedef {{ columns?: string[], rows?: QueryRow[], row_count?: number, truncated?: boolean, results?: QueryResult[] }} QueryResponse */

/**
 * @param {HTMLElement} target
 * @param {QueryResult[]} results
 */
function renderMultiQueryResults(target, results) {
    if (!Array.isArray(results) || !results.length) {
        target.className = 'status-box';
        target.textContent = '조회 결과가 없습니다.';
        return;
    }

    target.className = '';
    target.innerHTML = `
        <div class="query-multi-results">
            <div class="query-multi-panels" id="query-multi-panels"></div>
            <div class="query-multi-tabs" id="query-multi-tabs"></div>
        </div>
    `;

    const tabsHost = target.querySelector('#query-multi-tabs');
    const panelsHost = target.querySelector('#query-multi-panels');
    if (!tabsHost || !panelsHost) {
        return;
    }

    const activate = (index) => {
        tabsHost.querySelectorAll('.query-multi-tab').forEach((button) => {
            const el = /** @type {HTMLElement} */ (button);
            button.classList.toggle('active', Number(el.dataset.index) === index);
        });
        panelsHost.querySelectorAll('.query-multi-panel').forEach((panel) => {
            const el = /** @type {HTMLElement} */ (panel);
            panel.classList.toggle('active', Number(el.dataset.index) === index);
        });
    };

    results.forEach((result, idx) => {
        const index = idx + 1;
        const tab = document.createElement('button');
        tab.className = 'query-multi-tab';
        tab.dataset.index = String(index);
        tab.textContent = `result${index}`;
        tab.addEventListener('click', () => activate(index));
        tabsHost.appendChild(tab);

        const panel = document.createElement('div');
        panel.className = 'query-multi-panel';
        panel.dataset.index = String(index);
        panelsHost.appendChild(panel);

        renderResultContent(panel, result.columns || [], result.rows || []);
        attachGridInteractions(panel);
    });

    activate(1);
}

async function runQuery() {
    const target = document.getElementById('query-result');
    if (!target) {
        return;
    }

    if (!state.currentDatabase) {
        const selectedRow = getSelectedExplorerRow();
        if (selectedRow && selectedRow.dataset.type === 'file' && selectedRow.dataset.isSqlite === '1') {
            await openDatabase(selectedRow.dataset.path || '');
        }

        if (!state.currentDatabase) {
            target.className = 'status-box error';
            target.textContent = 'SQLite 파일을 먼저 열어주세요.';
            return;
        }
    }

    const sqlEditor = document.getElementById('sql-editor');
    if (!(sqlEditor instanceof HTMLTextAreaElement)) {
        target.className = 'status-box error';
        target.textContent = 'SQL 에디터를 찾을 수 없습니다.';
        return;
    }

    const sql = sqlEditor.value;
    const startedAt = new Date();
    const startedAtText = formatDateTime(startedAt);
    setStatus('Running query…', state.currentDatabase.name);
    target.className = 'status-box';
    target.textContent = '실행 중...';
    outputLog(`QUERY START at=${startedAtText} db=${state.currentDatabase.name}`);
    outputLog(`QUERY SQL ${sql.replace(/\s+/g, ' ').trim().slice(0, 180)}`);

    try {
        const data = /** @type {QueryResponse} */ (await requestJson('/api/query/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: state.currentDatabase.path, sql }),
        }));
        const finishedAt = new Date();
        const elapsedMs = finishedAt.getTime() - startedAt.getTime();
        const finishedAtText = formatDateTime(finishedAt);

        if (Array.isArray(data.results)) {
            renderMultiQueryResults(target, data.results);
            const totalRows = data.results.reduce(
                (acc, item) => acc + Number(item.row_count || item.rows?.length || 0),
                0
            );
            setStatus(`Results: ${data.results.length} | Rows: ${totalRows}`, `${elapsedMs} ms`);
            outputLog(`QUERY END at=${finishedAtText} elapsed=${elapsedMs}ms results=${data.results.length} rows=${totalRows}`);
            data.results.forEach((item, index) => {
                outputLog(`RESULT ${index + 1} rows=${Number(item.row_count || item.rows?.length || 0)}${item.truncated ? ' truncated=true' : ''}`);
            });
        } else {
            target.className = '';
            renderResultContent(target, data.columns, data.rows);
            attachGridInteractions(target);
            const fetchedRows = Number(data.row_count || 0);
            const truncatedText = data.truncated ? ' | Truncated' : '';
            setStatus(`Rows: ${fetchedRows}${truncatedText}`, `${elapsedMs} ms`);
            outputLog(`QUERY END at=${finishedAtText} elapsed=${elapsedMs}ms rows=${fetchedRows}${data.truncated ? ' truncated=true' : ''}`);
        }
    } catch (error) {
        target.className = 'status-box error';
        target.textContent = error.message;
        setStatus('Query failed', error.message);
        outputLog(`QUERY ERROR ${error.message}`, 'error');
    }
}
