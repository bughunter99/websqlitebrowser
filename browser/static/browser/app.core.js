        const state = {
            currentPath: '',
            currentDatabase: null,
            activeTab: null,
            loadedTables: new Map(),
            tableTabIds: new Map(),
        };

        const explorerList = document.getElementById('explorer-list');
        const panelStack = document.querySelector('.panel-stack');
        const explorerStatusbar = document.getElementById('explorer-statusbar');
        const currentPath = document.getElementById('current-path');
        const tabs = document.getElementById('tabs');
        const workspaceFrame = document.querySelector('.workspace-frame');
        const welcomeTab = document.getElementById('welcome-tab');
        const chatStatus = document.getElementById('chat-status');
        const chatResponse = document.getElementById('chat-response');
        const workspaceRoot = document.getElementById('workspace-root');
        const workspaceFile = document.getElementById('workspace-file');
        const workspaceReload = document.getElementById('workspace-reload');
        const workspaceFocusQuery = document.getElementById('workspace-focus-query');
        const outputBody = document.getElementById('output-body');

        const railButtons = Array.from(document.querySelectorAll('.rail-button'));
        let selectedExplorerPath = '';

        function getSelectedExplorerRow() {
            return explorerList.querySelector('.explorer-row.selected');
        }

        function setStatus(leftText, rightText) {
            const statusLeft = document.getElementById('status-left');
            const statusRight = document.getElementById('status-right');
            if (statusLeft && leftText !== undefined) {
                statusLeft.textContent = leftText;
            }
            if (statusRight && rightText !== undefined) {
                statusRight.textContent = rightText;
            }
        }

        function outputLog(message, level = 'info') {
            if (!outputBody) {
                return;
            }
            const stamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
            const line = document.createElement('div');
            line.className = `output-line${level === 'info' ? '' : ` ${level}`}`;
            line.textContent = `[${stamp}] ${message}`;
            outputBody.appendChild(line);

            const maxLines = 300;
            while (outputBody.childElementCount > maxLines) {
                outputBody.removeChild(outputBody.firstElementChild);
            }
            outputBody.scrollTop = outputBody.scrollHeight;
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        const SQL_KEYWORD_PATTERN = /\b(select|from|where|group|order|by|limit|join|left|right|inner|outer|on|as|and|or|not|null|is|in|exists|like|between|having|union|all|distinct|insert|into|values|update|set|delete|create|table|view|index|drop|alter|pragma|with|case|when|then|else|end|count|sum|min|max|avg)\b/gi;

        function renderSqlHighlight(textarea, highlight) {
            const source = textarea.value || '';
            const escaped = escapeHtml(source);
            const colored = escaped.replace(SQL_KEYWORD_PATTERN, '<span class="sql-kw">$1</span>');
            highlight.innerHTML = `${colored}\n`;
            highlight.scrollTop = textarea.scrollTop;
            highlight.scrollLeft = textarea.scrollLeft;
        }

        function initSqlHighlight() {
            const textarea = document.getElementById('sql-editor');
            const highlight = document.getElementById('sql-highlight');
            if (!textarea || !highlight) {
                return;
            }

            const sync = () => renderSqlHighlight(textarea, highlight);
            textarea.addEventListener('input', sync);
            textarea.addEventListener('scroll', sync);
            sync();
        }

        async function requestJson(url, options = {}) {
            const response = await fetch(url, { cache: 'no-store', ...options });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
            }
            return data;
        }

        function setPanel(target) {
            document.querySelectorAll('.panel').forEach((panel) => {
                panel.classList.toggle('active', panel.dataset.panel === target);
            });
            railButtons.forEach((button) => {
                button.classList.toggle('active', button.dataset.target === target);
            });
            panelStack.scrollTop = 0;
        }

        function renderExplorer(treeData) {
            const entries = Array.isArray(treeData.entries) ? treeData.entries : [];
            const head = `
                <div class="explorer-head">
                    <div>Name</div>
                    <div style="text-align: right;">Size</div>
                    <div style="text-align: right;">Modified</div>
                </div>
            `;

            const allEntries = [];
            if (treeData.parent_path) {
                allEntries.push({
                    name: '../',
                    path: treeData.parent_path || '',
                    type: 'parent',
                    is_sqlite: false,
                    size_human: '',
                    modified_at: '',
                });
            }
            allEntries.push(...entries);

            const rows = allEntries.map((entry) => {
                const sizeText = entry.type === 'file' ? (entry.size_human || '0 B') : '';
                const selectedClass = selectedExplorerPath && selectedExplorerPath === entry.path ? ' selected' : '';
                const parentClass = entry.type === 'parent' ? ' parent-row' : '';
                return `
                    <div class="explorer-row${selectedClass}${parentClass}" data-path="${escapeHtml(entry.path)}" data-type="${escapeHtml(entry.type)}" data-is-sqlite="${entry.is_sqlite ? '1' : '0'}">
                        <div class="explorer-name-col">
                            <span class="explorer-name">${escapeHtml(entry.name)}</span>
                        </div>
                        <div class="explorer-size">${escapeHtml(sizeText)}</div>
                        <div class="explorer-modified">${escapeHtml(entry.modified_at || '')}</div>
                    </div>
                `;
            }).join('');

            explorerList.innerHTML = head + rows;
        }

        async function loadTree(path = '') {
            try {
                const data = await requestJson(`/api/tree/?path=${encodeURIComponent(path)}`);
                state.currentPath = data.current_path;
                currentPath.textContent = `repository${data.current_path ? `/${data.current_path}` : ''}`;
                workspaceRoot.textContent = currentPath.textContent;
                outputLog(`DIR ${currentPath.textContent}`);
                const parentButton = document.getElementById('go-parent');
                parentButton.dataset.parentPath = data.parent_path;
                parentButton.disabled = !data.parent_path;

                const stats = data.stats || {};
                const disk = stats.disk || {};
                explorerStatusbar.textContent = [
                    `folders ${Number(stats.directories || 0)}`,
                    `files ${Number(stats.files || 0)}`,
                    `size ${stats.total_size_human || '0 B'}`,
                    `disk ${Number(disk.used_percent || 0).toFixed(1)}%`,
                ].join(' | ');

                renderExplorer(data);
            } catch (error) {
                explorerList.innerHTML = `<div class="status-box error">${escapeHtml(error.message)}</div>`;
                explorerStatusbar.textContent = 'folders 0 | files 0 | size 0 B | disk 0%';
                outputLog(`DIR ERROR ${error.message}`, 'error');
            }
        }

        function renderTable(columns, rows) {
            if (!columns.length) {
                return '<div class="empty-state">결과 컬럼이 없습니다.</div>';
            }

            const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
            const body = rows.length
                ? rows.map((row, rowIndex) => `
                    <tr>${columns.map((column, columnIndex) => `<td data-row="${rowIndex}" data-col="${columnIndex}">${escapeHtml(row[column] ?? '')}</td>`).join('')}</tr>
                `).join('')
                : `<tr><td colspan="${columns.length}">조회 결과가 없습니다.</td></tr>`;

            return `
                <div class="table-wrap">
                    <table class="result-grid">
                        <thead><tr>${head}</tr></thead>
                        <tbody>${body}</tbody>
                    </table>
                </div>
            `;
        }

        function renderVirtualizedTable(target, columns, rows) {
            if (!columns.length) {
                target.innerHTML = '<div class="empty-state">결과 컬럼이 없습니다.</div>';
                return;
            }

            const rowHeight = 22;
            const overscan = 10;
            const templateColumns = `repeat(${columns.length}, minmax(120px, 1fr))`;

            target.innerHTML = `
                <div class="virtual-grid-wrap">
                    <div class="virtual-grid-head" style="grid-template-columns:${templateColumns};">
                        ${columns.map((column) => `<div class="virtual-grid-th">${escapeHtml(column)}</div>`).join('')}
                    </div>
                    <div class="virtual-grid-body" id="virtual-grid-body">
                        <div class="virtual-grid-spacer" id="virtual-grid-spacer"></div>
                        <div class="virtual-grid-rows" id="virtual-grid-rows"></div>
                    </div>
                </div>
            `;

            const body = target.querySelector('#virtual-grid-body');
            const spacer = target.querySelector('#virtual-grid-spacer');
            const rowsLayer = target.querySelector('#virtual-grid-rows');
            if (!body || !spacer || !rowsLayer) {
                return;
            }

            spacer.style.height = `${rows.length * rowHeight}px`;
            let lastStart = -1;
            let lastEnd = -1;

            const renderWindow = () => {
                const viewportHeight = body.clientHeight || 320;
                const scrollTop = body.scrollTop;
                const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
                const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
                const end = Math.min(rows.length, start + visibleCount);

                if (start === lastStart && end === lastEnd) {
                    return;
                }

                lastStart = start;
                lastEnd = end;
                rowsLayer.style.transform = `translateY(${start * rowHeight}px)`;

                const windowRows = rows.slice(start, end);
                rowsLayer.innerHTML = windowRows.map((row, offset) => {
                    const rowIndex = start + offset;
                    const cells = columns.map((column, columnIndex) => {
                        return `<div class="virtual-grid-td" data-row="${rowIndex}" data-col="${columnIndex}">${escapeHtml(row[column] ?? '')}</div>`;
                    }).join('');
                    return `<div class="virtual-grid-tr" style="grid-template-columns:${templateColumns};">${cells}</div>`;
                }).join('');
            };

            body.addEventListener('scroll', renderWindow);
            renderWindow();
        }

        function renderResultContent(target, columns, rows) {
            if (rows.length >= 1000) {
                renderVirtualizedTable(target, columns, rows);
                return;
            }
            target.innerHTML = renderTable(columns, rows);
        }

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
                                <p class="ddl-subtitle">컬럼 정의와 인덱스, 원본 CREATE SQL을 확인할 수 있습니다.</p>
                            </div>
                            <pre>${escapeHtml(table.create_sql || 'CREATE SQL 정보가 없습니다.')}</pre>
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

        function renderChatResponse(data) {
            const parts = [];
            parts.push(`<div class="status-box"><strong>Answer</strong><div style="margin-top: 8px; white-space: pre-wrap;">${escapeHtml(data.answer || '')}</div></div>`);

            if (data.suggested_sql) {
                parts.push(`<div class="status-box" style="margin-top: 12px;"><strong>SQL</strong><pre style="margin: 8px 0 0; white-space: pre-wrap;">${escapeHtml(data.suggested_sql)}</pre></div>`);
            }

            if (data.query_result) {
                if (data.query_result.error) {
                    parts.push(`<div class="status-box error" style="margin-top: 12px;">${escapeHtml(data.query_result.error)}</div>`);
                } else {
                    parts.push(`<div style="margin-top: 12px;">${renderTable(data.query_result.columns || [], data.query_result.rows || [])}</div>`);
                }
            }

            return parts.join('');
        }

        function attachGridInteractions(container) {
            const grid = container.querySelector('.result-grid, .virtual-grid-wrap');
            if (!grid) {
                return;
            }

            grid.addEventListener('click', (event) => {
                const cell = event.target.closest('td, .virtual-grid-td');
                if (!cell) {
                    return;
                }

                if (event.ctrlKey || event.metaKey) {
                    cell.classList.toggle('is-selected');
                    return;
                }

                grid.querySelectorAll('td.is-selected, .virtual-grid-td.is-selected').forEach((selectedCell) => {
                    selectedCell.classList.remove('is-selected');
                });
                cell.classList.add('is-selected');
            });
        }

        function copySelectedCells() {
            const selectedCells = Array.from(document.querySelectorAll('.result-grid td.is-selected, .virtual-grid-td.is-selected'));
            if (!selectedCells.length) {
                return false;
            }

            const groupedRows = new Map();
            selectedCells
                .sort((left, right) => Number(left.dataset.row) - Number(right.dataset.row) || Number(left.dataset.col) - Number(right.dataset.col))
                .forEach((cell) => {
                    const rowIndex = Number(cell.dataset.row);
                    if (!groupedRows.has(rowIndex)) {
                        groupedRows.set(rowIndex, []);
                    }
                    groupedRows.get(rowIndex).push(cell.textContent);
                });

            const clipboardText = Array.from(groupedRows.values()).map((row) => row.join('\t')).join('\n');

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(clipboardText).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = clipboardText;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                });
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = clipboardText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }

            return true;
        }

        function ensureTab(id, title, contentHtml) {
            let tabButton = document.querySelector(`[data-tab="${id}"]`);
            let tabContent = document.getElementById(`tab-${id}`);

            if (!tabButton) {
                tabButton = document.createElement('button');
                tabButton.className = 'tab-button';
                tabButton.dataset.tab = id;
                tabButton.textContent = title;
                tabButton.addEventListener('click', () => activateTab(id));
                tabs.appendChild(tabButton);
            }

            if (!tabContent) {
                tabContent = document.createElement('section');
                tabContent.id = `tab-${id}`;
                tabContent.className = 'tab-content';
                workspaceFrame.appendChild(tabContent);
            }

            if (contentHtml !== undefined) {
                tabContent.innerHTML = contentHtml;
            }
        }

        function activateTab(id) {
            state.activeTab = id;
            welcomeTab.classList.remove('active');

            document.querySelectorAll('.tab-button').forEach((button) => {
                button.classList.toggle('active', button.dataset.tab === id);
            });
            document.querySelectorAll('.tab-content').forEach((content) => {
                content.classList.toggle('active', content.id === `tab-${id}`);
            });
        }

        function initQuerySplit() {
            const layout = document.getElementById('query-layout');
            const splitter = document.getElementById('query-splitter');
            const editorPane = document.getElementById('query-pane-editor');
            if (!layout || !splitter || !editorPane) {
                return;
            }

            let dragging = false;
            let startY = 0;
            let startHeight = 0;
            const splitterHeight = 8;
            const minTop = 74;
            const minBottom = 84;
            let ratio = 44;

            const applyRatio = () => {
                const safe = Math.max(22, Math.min(78, ratio));
                layout.style.setProperty('--query-top-ratio', `${safe}%`);
            };

            applyRatio();

            const onPointerMove = (event) => {
                if (!dragging) {
                    return;
                }

                const rect = layout.getBoundingClientRect();
                const deltaY = event.clientY - startY;
                let nextTop = startHeight + deltaY;
                const maxTop = rect.height - splitterHeight - minBottom;
                if (nextTop < minTop) {
                    nextTop = minTop;
                }
                if (nextTop > maxTop) {
                    nextTop = maxTop;
                }

                const movableHeight = Math.max(1, rect.height - splitterHeight);
                ratio = (nextTop / movableHeight) * 100;
                applyRatio();
            };

            const stopDragging = () => {
                if (!dragging) {
                    return;
                }
                dragging = false;
                splitter.classList.remove('is-dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };

            splitter.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                dragging = true;
                startY = event.clientY;
                startHeight = editorPane.getBoundingClientRect().height;
                splitter.classList.add('is-dragging');
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
                splitter.setPointerCapture(event.pointerId);
            });

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', stopDragging);
            window.addEventListener('pointercancel', stopDragging);
            splitter.addEventListener('dblclick', () => {
                ratio = 44;
                applyRatio();
            });

            window.addEventListener('resize', () => {
                applyRatio();
            });
        }

        async function openDatabase(path) {
            try {
                const data = await requestJson(`/api/database/?path=${encodeURIComponent(path)}`);
                state.currentDatabase = data.database;
                state.loadedTables.clear();
                state.tableTabIds.clear();

                workspaceFile.textContent = data.database.name;
                setStatus(`Opened: ${data.database.name}`, `Tables: ${data.database.tables.length}`);
                outputLog(`OPEN ${data.database.path}`);
                tabs.innerHTML = '';
                document.querySelectorAll('.tab-content').forEach((content) => {
                    if (content !== welcomeTab) {
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

            const sql = document.getElementById('sql-editor').value;
            setStatus('Running query…', state.currentDatabase.name);
            target.className = 'status-box';
            target.textContent = '실행 중...';
            outputLog(`QUERY ${sql.replace(/\s+/g, ' ').trim().slice(0, 180)}`);

            try {
                const data = await requestJson('/api/query/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: state.currentDatabase.path, sql }),
                });
                target.className = '';
                renderResultContent(target, data.columns, data.rows);
                attachGridInteractions(target);
                setStatus(`Rows: ${data.row_count}`, data.truncated ? 'Truncated' : state.currentDatabase.name);
                outputLog(`QUERY OK rows=${Number(data.row_count || 0)}${data.truncated ? ' truncated=true' : ''}`);
            } catch (error) {
                target.className = 'status-box error';
                target.textContent = error.message;
                setStatus('Query failed', error.message);
                outputLog(`QUERY ERROR ${error.message}`, 'error');
            }
        }

        async function loadSettings() {
            try {
                const data = await requestJson('/api/settings/');
                document.getElementById('llm-endpoint').value = data.settings.endpoint || '';
                document.getElementById('llm-token').value = data.settings.token || '';
                document.getElementById('llm-model').value = data.settings.model || '';
                document.getElementById('settings-status').textContent = '서버 설정을 불러왔습니다.';
            } catch (error) {
                document.getElementById('settings-status').textContent = error.message;
            }
        }

        async function testSettingsConnection() {
            const status = document.getElementById('settings-status');
            status.className = 'status-box';
            status.textContent = '연결을 테스트하는 중...';

            try {
                const payload = {
                    endpoint: document.getElementById('llm-endpoint').value,
                    token: document.getElementById('llm-token').value,
                    model: document.getElementById('llm-model').value,
                };
                const data = await requestJson('/api/settings/test/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                status.textContent = `연결 성공: ${data.provider}`;
            } catch (error) {
                status.className = 'status-box error';
                status.textContent = error.message;
            }
        }
