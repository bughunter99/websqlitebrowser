/**
 * app.db.js - Database Operations
 * DB 오픈/테이블 로드/DDL 렌더링
 */

function renderMetaTable(headers, rows) {
    if (!rows.length) {
        return '<div class="empty-state">정보가 없습니다.</div>';
    }

    const head = headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join('');
    const body = rows.map((row) => `
        <tr>${headers.map((header) => `<td>${escapeHtml(row[header.key] ?? '')}</td>`).join('')}</tr>
    `).join('');

    return `
        <div class="meta-table">
            <table>
                <thead><tr>${head}</tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
    `;
}

function renderDdlContent(tables) {
    if (!tables.length) {
        return '<div class="empty-state">DDL 정보를 표시할 테이블이 없습니다.</div>';
    }

    return `
        <div class="ddl-grid">
            ${tables.map((table) => `
                <section class="ddl-section">
                    <div>
                        <h4>${escapeHtml(table.name)}</h4>
                    </div>
                    <div>
                        <strong>Columns</strong>
                        ${renderMetaTable([
                            { key: 'cid', label: 'cid' },
                            { key: 'name', label: 'name' },
                            { key: 'type', label: 'type' },
                            { key: 'notnull', label: 'notnull' },
                            { key: 'dflt_value', label: 'default' },
                            { key: 'pk', label: 'pk' },
                        ], table.columns || [])}
                    </div>
                    <div>
                        <strong>Indexes</strong>
                        ${table.indexes && table.indexes.length ? renderMetaTable([
                            { key: 'name', label: 'name' },
                            { key: 'unique', label: 'unique' },
                            { key: 'origin', label: 'origin' },
                            { key: 'partial', label: 'partial' },
                            { key: 'columns', label: 'columns' },
                            { key: 'sql', label: 'sql' },
                        ], table.indexes.map((indexItem) => ({
                            ...indexItem,
                            unique: indexItem.unique ? 'true' : 'false',
                            partial: indexItem.partial ? 'true' : 'false',
                            columns: Array.isArray(indexItem.columns) ? indexItem.columns.join(', ') : indexItem.columns,
                        }))) : '<div class="empty-state">인덱스가 없습니다.</div>'}
                    </div>
                </section>
            `).join('')}
        </div>
    `;
}

async function openDatabase(path) {
    try {
        const data = await requestJson(`/api/database/?path=${encodeURIComponent(path)}`);
        state.currentDatabase = data.database;
        state.loadedTables.clear();
        state.tableTabIds.clear();

        domElements.workspaceFile.textContent = data.database.name;
        setStatus(`Opened: ${data.database.name}`, `Tables: ${data.database.tables.length}`);
        outputLog(`OPEN ${data.database.path}`);
        domElements.tabs.innerHTML = '';
        document.querySelectorAll('.tab-content').forEach((content) => {
            if (content !== domElements.welcomeTab) {
                content.remove();
            }
        });

        ensureTab(
            'query',
            'Query',
            `
                <div class="query-layout" id="query-layout">
                    <div class="query-pane" id="query-pane-editor">
                        <label class="section-label" for="sql-editor">SQL</label>
                        <div class="sql-editor-shell" id="sql-editor-shell">
                            <pre id="sql-highlight" aria-hidden="true"></pre>
                            <textarea id="sql-editor" spellcheck="false">SELECT name FROM sqlite_master WHERE type = 'table';</textarea>
                        </div>
                    </div>
                    <div class="query-splitter" id="query-splitter" role="separator" aria-orientation="horizontal" title="드래그해서 높이 조정"></div>
                    <div class="query-pane query-pane-result">
                        <label class="section-label">결과</label>
                        <div class="query-result-wrap">
                            <div id="query-result" class="status-box"></div>
                        </div>
                    </div>
                </div>
            `
        );

        ensureTab(
            'ddl',
            'DDL',
            renderDdlContent(data.database.tables)
        );

        data.database.tables.forEach((table, index) => {
            const tabId = `table-${index}`;
            state.tableTabIds.set(table.name, tabId);

            ensureTab(
                tabId,
                table.name,
                `
                    <div id="table-result-${tabId}" class="status-box"></div>
                `
            );

            const button = document.querySelector(`[data-tab="${tabId}"]`);
            button.addEventListener('click', () => {
                activateTab(tabId);
                loadTable(table.name, tabId);
            });
        });

        document.getElementById('test-settings').addEventListener('click', testSettingsConnection);
        initQuerySplit();
        initSqlHighlight();

        activateTab('query');
    } catch (error) {
        setStatus('Open database failed', error.message);
        outputLog(`OPEN ERROR ${error.message}`, 'error');
    }
}

async function loadTable(tableName, tabId = state.tableTabIds.get(tableName)) {
    if (!state.currentDatabase || !tabId || state.loadedTables.has(tableName)) {
        return;
    }

    const target = document.getElementById(`table-result-${tabId}`);
    if (!target) {
        return;
    }

    target.className = 'status-box';
    target.textContent = '로딩 중...';

    try {
        const data = await requestJson(`/api/table/?path=${encodeURIComponent(state.currentDatabase.path)}&table=${encodeURIComponent(tableName)}&all=1`);
        target.className = '';
        renderResultContent(target, data.columns, data.rows);
        attachGridInteractions(target);
        state.loadedTables.set(tableName, true);
        outputLog(`TABLE ${tableName} rows=${Number(data.row_count || data.rows?.length || 0)}`);
    } catch (error) {
        target.className = 'status-box error';
        target.textContent = error.message;
        outputLog(`TABLE ERROR ${tableName} ${error.message}`, 'error');
    }
}
