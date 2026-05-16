/**
 * app.db.view.js - Database View Builders
 * DB 탭/DDL 렌더링 전용
 */

function renderDbMetaTable(headers, rows) {
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

function renderDatabaseDdlContent(tables) {
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
                        ${renderDbMetaTable([
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
                        ${table.indexes && table.indexes.length ? renderDbMetaTable([
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

function buildQueryTabContent() {
    return `
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
    `;
}

function resetWorkspaceTabs() {
    domElements.tabs.innerHTML = '';
    document.querySelectorAll('.tab-content').forEach((content) => {
        if (content !== domElements.welcomeTab) {
            content.remove();
        }
    });
}

function buildTableTabContent(tabId) {
    return `
        <div id="table-result-${tabId}" class="status-box"></div>
    `;
}

function buildDatabaseTabs(tables, onTableTabOpen) {
    ensureTab('query', 'Query', buildQueryTabContent());
    ensureTab('ddl', 'DDL', renderDatabaseDdlContent(tables));

    const tableTabIds = new Map();
    tables.forEach((table, index) => {
        const tabId = `table-${index}`;
        tableTabIds.set(table.name, tabId);

        ensureTab(tabId, table.name, buildTableTabContent(tabId));

        const button = document.querySelector(`[data-tab="${tabId}"]`);
        if (button) {
            button.addEventListener('click', () => {
                onTableTabOpen(table.name, tabId);
            });
        }
    });

    return tableTabIds;
}
