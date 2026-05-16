        const state = {
            currentPath: '',
            currentDatabase: null,
            activeTab: null,
            loadedTables: new Map(),
            tableTabIds: new Map(),
            explorerFilter: '',
            lastTreeData: null,
            // Grid state for 1st phase features
            activeCell: null, // { row, col }
            selectedCells: new Set(), // "row,col" format
            selectionStart: null, // { row, col }
            selectionEnd: null, // { row, col }
            gridDragging: false,
            gridLastClickedCell: null,
        };

        const explorerList = document.getElementById('explorer-list');
        const panelStack = document.querySelector('.panel-stack');
        const explorerStatusbar = document.getElementById('explorer-statusbar');
        const currentPath = document.getElementById('workspace-root');
        const tabs = document.getElementById('tabs');
        const workspaceFrame = document.querySelector('.workspace-frame');
        const welcomeTab = document.getElementById('welcome-tab');
        const chatStatus = document.getElementById('chat-status');
        const chatResponse = document.getElementById('chat-response');
        const workspaceFile = document.getElementById('workspace-file');
        const workspaceReload = document.getElementById('workspace-reload');
        const outputBody = document.getElementById('output-body');

        const railButtons = Array.from(document.querySelectorAll('.rail-button'));
        let selectedExplorerPath = '';
        const gridRenderState = new WeakMap();
        let gridContextMenu = null;

        function hideGridContextMenu() {
            if (gridContextMenu) {
                gridContextMenu.remove();
                gridContextMenu = null;
            }
        }

        function copyTextToClipboard(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                });
                return;
            }

            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }

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
            const now = new Date();
            const pad = (number) => String(number).padStart(2, '0');
            const stamp = [
                now.getFullYear(),
                pad(now.getMonth() + 1),
                pad(now.getDate()),
            ].join('') + ' ' + [
                pad(now.getHours()),
                pad(now.getMinutes()),
                pad(now.getSeconds()),
            ].join('');
            const line = document.createElement('div');
            line.className = `output-line${level === 'info' ? '' : ` ${level}`}`;
            line.textContent = `${stamp} ${message}`;
            outputBody.appendChild(line);

            const maxLines = 300;
            while (outputBody.childElementCount > maxLines) {
                outputBody.removeChild(outputBody.firstElementChild);
            }
            outputBody.scrollTop = outputBody.scrollHeight;
        }

        function formatDateTime(value) {
            const pad = (number) => String(number).padStart(2, '0');
            return [
                value.getFullYear(),
                pad(value.getMonth() + 1),
                pad(value.getDate()),
            ].join('-') + ' ' + [
                pad(value.getHours()),
                pad(value.getMinutes()),
                pad(value.getSeconds()),
            ].join(':');
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        function escapeRegExp(value) {
            return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function highlightExplorerName(text, query) {
            const source = String(text ?? '');
            const q = String(query ?? '').trim();
            if (!q) {
                return escapeHtml(source);
            }

            const pattern = new RegExp(escapeRegExp(q), 'ig');
            let lastIndex = 0;
            let html = '';

            source.replace(pattern, (match, offset) => {
                html += escapeHtml(source.slice(lastIndex, offset));
                html += `<mark class="explorer-match">${escapeHtml(match)}</mark>`;
                lastIndex = offset + match.length;
                return match;
            });

            html += escapeHtml(source.slice(lastIndex));
            return html;
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
            const filterQuery = String(state.explorerFilter || '').trim().toLowerCase();
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
            const filteredEntries = filterQuery
                ? entries.filter((entry) => String(entry.name || '').toLowerCase().includes(filterQuery))
                : entries;
            allEntries.push(...filteredEntries);

            const rows = allEntries.map((entry) => {
                const sizeText = entry.type === 'file' ? (entry.size_human || '0 B') : '';
                const selectedClass = selectedExplorerPath && selectedExplorerPath === entry.path ? ' selected' : '';
                const parentClass = entry.type === 'parent' ? ' parent-row' : '';
                return `
                    <div class="explorer-row${selectedClass}${parentClass}" data-path="${escapeHtml(entry.path)}" data-type="${escapeHtml(entry.type)}" data-is-sqlite="${entry.is_sqlite ? '1' : '0'}">
                        <div class="explorer-name-col">
                            <span class="explorer-name">${highlightExplorerName(entry.name, state.explorerFilter)}</span>
                        </div>
                        <div class="explorer-size">${escapeHtml(sizeText)}</div>
                        <div class="explorer-modified">${escapeHtml(entry.modified_at || '')}</div>
                    </div>
                `;
            }).join('');

            explorerList.innerHTML = head + rows;
        }

        function setExplorerFilter(value) {
            state.explorerFilter = String(value ?? '');
            if (state.lastTreeData) {
                renderExplorer(state.lastTreeData);
            }
        }

        async function loadTree(path = '') {
            try {
                const data = await requestJson(`/api/tree/?path=${encodeURIComponent(path)}`);
                state.currentPath = data.current_path;
                state.lastTreeData = data;
                const displayPath = data.current_abs_path || `repository${data.current_path ? `/${data.current_path}` : ''}`;
                currentPath.textContent = displayPath;
                outputLog(`DIR ${currentPath.textContent}`);
                const parentButton = document.getElementById('go-parent');
                if (parentButton) {
                    parentButton.dataset.parentPath = data.parent_path;
                    parentButton.disabled = !data.parent_path;
                }

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

        function sortRowsByColumn(rows, columns, sortState) {
            if (!sortState || typeof sortState.col !== 'number' || !sortState.dir) {
                return rows;
            }
            const columnName = columns[sortState.col];
            if (!columnName) {
                return rows;
            }

            const direction = sortState.dir === 'desc' ? -1 : 1;
            return [...rows].sort((leftRow, rightRow) => {
                const leftValue = leftRow[columnName];
                const rightValue = rightRow[columnName];

                const leftNumber = Number(leftValue);
                const rightNumber = Number(rightValue);
                const numberComparable = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
                if (numberComparable) {
                    return (leftNumber - rightNumber) * direction;
                }

                return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * direction;
            });
        }

        function getInitialColumnWidthByHeader(headerText) {
            const text = String(headerText ?? '');
            // Approximate width by character count so initial size follows header text length.
            const estimated = Math.ceil(text.length * 8) + 24;
            return Math.min(320, Math.max(72, estimated));
        }

        function renderTable(columns, rows, sortState = null) {
            if (!columns.length) {
                return '<div class="empty-state">결과 컬럼이 없습니다.</div>';
            }

            const sortedRows = sortRowsByColumn(rows, columns, sortState);
            const head = columns.map((column, columnIndex) => `
                <th data-col="${columnIndex}" class="grid-sortable ${sortState && sortState.col === columnIndex ? `sorted-${sortState.dir}` : ''}">
                    <span class="result-th-label">${escapeHtml(column)}</span>
                    <span class="sort-indicator">${sortState && sortState.col === columnIndex ? (sortState.dir === 'asc' ? '▲' : '▼') : ''}</span>
                    <span class="result-col-resizer" data-col="${columnIndex + 1}"></span>
                </th>
            `).join('');
            const colgroup = [
                '<col style="width: 36px;">',
                ...columns.map((column) => `<col style="width: ${getInitialColumnWidthByHeader(column)}px;">`),
            ].join('');
            const body = sortedRows.length
                ? sortedRows.map((row, rowIndex) => `
                    <tr>
                        <td class="row-index-cell">${rowIndex + 1}</td>
                        ${columns.map((column, columnIndex) => `<td data-row="${rowIndex}" data-col="${columnIndex}">${escapeHtml(row[column] ?? '')}</td>`).join('')}
                    </tr>
                `).join('')
                : `<tr><td colspan="${columns.length + 1}">조회 결과가 없습니다.</td></tr>`;

            return `
                <div class="table-wrap">
                    <table class="result-grid">
                        <colgroup>${colgroup}</colgroup>
                        <thead><tr><th class="row-index-head">#</th>${head}</tr></thead>
                        <tbody>${body}</tbody>
                    </table>
                </div>
            `;
        }

        function renderVirtualizedTable(target, columns, rows, sortState = null) {
            if (!columns.length) {
                target.innerHTML = '<div class="empty-state">결과 컬럼이 없습니다.</div>';
                return;
            }

            const sortedRows = sortRowsByColumn(rows, columns, sortState);
            const rowHeight = 22;
            const overscan = 10;
            const columnWidths = [36, ...columns.map((column) => getInitialColumnWidthByHeader(column))];
            const minColumnWidth = 80;
            const getTemplateColumns = () => columnWidths.map((width) => `${width}px`).join(' ');
            const applyTemplateColumns = () => {
                const template = getTemplateColumns();
                const head = target.querySelector('.virtual-grid-head');
                if (head) {
                    head.style.gridTemplateColumns = template;
                }
                target.querySelectorAll('.virtual-grid-tr').forEach((rowEl) => {
                    rowEl.style.gridTemplateColumns = template;
                });
            };

            target.innerHTML = `
                <div class="virtual-grid-wrap" tabindex="0">
                    <div class="virtual-grid-head" style="grid-template-columns:${getTemplateColumns()};" data-column-count="${columns.length}">
                        <div class="virtual-grid-th row-index-head">#</div>
                        ${columns.map((column, columnIndex) => `
                            <div class="virtual-grid-th grid-sortable ${sortState && sortState.col === columnIndex ? `sorted-${sortState.dir}` : ''}" data-col="${columnIndex}">
                                <span class="virtual-grid-th-label">${escapeHtml(column)}</span>
                                <span class="sort-indicator">${sortState && sortState.col === columnIndex ? (sortState.dir === 'asc' ? '▲' : '▼') : ''}</span>
                                <span class="virtual-grid-col-resizer" data-col="${columnIndex + 1}"></span>
                            </div>
                        `).join('')}
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

            spacer.style.height = `${sortedRows.length * rowHeight}px`;
            let lastStart = -1;
            let lastEnd = -1;

            const renderWindow = (force = false) => {
                const viewportHeight = body.clientHeight || 320;
                const scrollTop = body.scrollTop;
                const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
                const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
                const end = Math.min(sortedRows.length, start + visibleCount);

                if (!force && start === lastStart && end === lastEnd) {
                    return;
                }

                lastStart = start;
                lastEnd = end;
                rowsLayer.style.transform = `translateY(${start * rowHeight}px)`;

                const windowRows = sortedRows.slice(start, end);
                rowsLayer.innerHTML = windowRows.map((row, offset) => {
                    const rowIndex = start + offset;
                    const cells = columns.map((column, columnIndex) => {
                        return `<div class="virtual-grid-td" data-row="${rowIndex}" data-col="${columnIndex}">${escapeHtml(row[column] ?? '')}</div>`;
                    }).join('');
                    return `<div class="virtual-grid-tr" style="grid-template-columns:${getTemplateColumns()};"><div class="virtual-grid-td row-index-cell">${rowIndex + 1}</div>${cells}</div>`;
                }).join('');
            };

            const resizers = Array.from(target.querySelectorAll('.virtual-grid-col-resizer'));
            resizers.forEach((resizer) => {
                resizer.addEventListener('mousedown', (event) => {
                    if (event.button !== 0) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    target.dataset.gridResizing = '1';

                    const colIndex = Number(resizer.dataset.col);
                    if (isNaN(colIndex)) {
                        return;
                    }

                    const startX = event.clientX;
                    const startWidth = columnWidths[colIndex] || 160;

                    const onMouseMove = (moveEvent) => {
                        const deltaX = moveEvent.clientX - startX;
                        columnWidths[colIndex] = Math.max(minColumnWidth, startWidth + deltaX);
                        applyTemplateColumns();
                        renderWindow(true);
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        setTimeout(() => {
                            delete target.dataset.gridResizing;
                        }, 0);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            });

            body.addEventListener('scroll', renderWindow);
            renderWindow();
        }

        function renderResultContent(target, columns, rows) {
            const renderState = gridRenderState.get(target) || { sort: null };
            const sourceRows = Array.isArray(rows) ? rows : [];
            gridRenderState.set(target, { columns, rows: sourceRows, sort: renderState.sort || null });

            if (sourceRows.length >= 1000) {
                renderVirtualizedTable(target, columns, sourceRows, renderState.sort || null);
                initGridSorting(target);
                return;
            }
            target.innerHTML = renderTable(columns, sourceRows, renderState.sort || null);
            initGridSorting(target);
        }

        function initGridSorting(target) {
            const stateForTarget = gridRenderState.get(target);
            if (!stateForTarget) {
                return;
            }

            const sortableHeaders = Array.from(target.querySelectorAll('.grid-sortable'));
            sortableHeaders.forEach((header) => {
                header.addEventListener('click', (event) => {
                    if (event.target.closest('.result-col-resizer, .virtual-grid-col-resizer')) {
                        return;
                    }
                    if (target.dataset.gridResizing === '1') {
                        return;
                    }

                    const colIndex = Number(header.dataset.col);
                    if (isNaN(colIndex)) {
                        return;
                    }

                    const currentSort = stateForTarget.sort;
                    const nextSort = currentSort && currentSort.col === colIndex && currentSort.dir === 'asc'
                        ? { col: colIndex, dir: 'desc' }
                        : { col: colIndex, dir: 'asc' };

                    gridRenderState.set(target, { ...stateForTarget, sort: nextSort });
                    renderResultContent(target, stateForTarget.columns, stateForTarget.rows);
                    attachGridInteractions(target);
                });
            });
        }

        function initResultGridColumnResize(container) {
            const table = container.querySelector('.result-grid');
            if (!table || table.dataset.resizeInit === '1') {
                return;
            }
            table.dataset.resizeInit = '1';

            const cols = Array.from(table.querySelectorAll('colgroup col'));
            if (!cols.length) {
                return;
            }

            const resizers = Array.from(table.querySelectorAll('.result-col-resizer'));
            resizers.forEach((resizer) => {
                resizer.addEventListener('mousedown', (event) => {
                    if (event.button !== 0) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    container.dataset.gridResizing = '1';

                    const colIndex = Number(resizer.dataset.col);
                    if (isNaN(colIndex) || !cols[colIndex]) {
                        return;
                    }

                    const startX = event.clientX;
                    const startWidth = cols[colIndex].getBoundingClientRect().width;

                    const onMouseMove = (moveEvent) => {
                        const deltaX = moveEvent.clientX - startX;
                        const nextWidth = Math.max(80, startWidth + deltaX);
                        cols[colIndex].style.width = `${nextWidth}px`;
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        setTimeout(() => {
                            delete container.dataset.gridResizing;
                        }, 0);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            });
        }

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
                    button.classList.toggle('active', Number(button.dataset.index) === index);
                });
                panelsHost.querySelectorAll('.query-multi-panel').forEach((panel) => {
                    panel.classList.toggle('active', Number(panel.dataset.index) === index);
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

            initResultGridColumnResize(container);

            const getRowCol = (cell) => {
                const row = Number(cell.dataset.row);
                const col = Number(cell.dataset.col);
                return isNaN(row) || isNaN(col) ? null : { row, col };
            };

            const getCellKey = (row, col) => `${row},${col}`;

            const getCellByRowCol = (row, col) => {
                const key = `[data-row="${row}"][data-col="${col}"]`;
                return grid.querySelector(`.virtual-grid-td${key}, td${key}`);
            };

            const updateSelectionDisplay = () => {
                grid.querySelectorAll('td, .virtual-grid-td').forEach((cell) => {
                    const rc = getRowCol(cell);
                    if (!rc) {
                        return;
                    }
                    const key = getCellKey(rc.row, rc.col);
                    cell.classList.toggle('is-selected', state.selectedCells.has(key));
                    cell.classList.toggle('is-active', state.activeCell && state.activeCell.row === rc.row && state.activeCell.col === rc.col);
                });
            };

            const setActiveCell = (row, col) => {
                state.activeCell = { row, col };
                updateSelectionDisplay();
                bringActiveCellIntoView(container);
            };

            const selectRange = (start, end) => {
                state.selectedCells.clear();
                const minRow = Math.min(start.row, end.row);
                const maxRow = Math.max(start.row, end.row);
                const minCol = Math.min(start.col, end.col);
                const maxCol = Math.max(start.col, end.col);

                for (let r = minRow; r <= maxRow; r++) {
                    for (let c = minCol; c <= maxCol; c++) {
                        state.selectedCells.add(getCellKey(r, c));
                    }
                }
                updateSelectionDisplay();
            };

            const selectEntireRow = (rowIndex) => {
                const rowCells = Array.from(grid.querySelectorAll(`[data-row="${rowIndex}"][data-col]`));
                if (!rowCells.length) {
                    return;
                }
                state.selectedCells.clear();
                rowCells.forEach((cell) => {
                    const rc = getRowCol(cell);
                    if (rc) {
                        state.selectedCells.add(getCellKey(rc.row, rc.col));
                    }
                });
                const first = getRowCol(rowCells[0]);
                if (first) {
                    setActiveCell(first.row, first.col);
                }
                updateSelectionDisplay();
            };

            // Mouse interactions
            grid.addEventListener('mousedown', (event) => {
                grid.focus();
                const cell = event.target.closest('td, .virtual-grid-td');
                if (!cell) {
                    return;
                }

                const rc = getRowCol(cell);
                if (!rc) {
                    return;
                }

                event.preventDefault();
                state.gridDragging = true;
                state.gridLastClickedCell = rc;

                if (event.shiftKey && state.activeCell) {
                    selectRange(state.activeCell, rc);
                } else if (event.ctrlKey || event.metaKey) {
                    const key = getCellKey(rc.row, rc.col);
                    state.selectedCells.has(key) ? state.selectedCells.delete(key) : state.selectedCells.add(key);
                    setActiveCell(rc.row, rc.col);
                } else {
                    state.selectedCells.clear();
                    state.selectedCells.add(getCellKey(rc.row, rc.col));
                    setActiveCell(rc.row, rc.col);
                }
            });

            grid.addEventListener('mousemove', (event) => {
                if (!state.gridDragging || !state.gridLastClickedCell) {
                    return;
                }

                const cell = event.target.closest('td, .virtual-grid-td');
                if (!cell) {
                    return;
                }

                const rc = getRowCol(cell);
                if (!rc) {
                    return;
                }

                selectRange(state.gridLastClickedCell, rc);
            });

            grid.addEventListener('contextmenu', (event) => {
                const cell = event.target.closest('td, .virtual-grid-td');
                if (!cell || cell.classList.contains('row-index-cell')) {
                    return;
                }

                const rc = getRowCol(cell);
                if (!rc) {
                    return;
                }

                event.preventDefault();
                hideGridContextMenu();

                const menu = document.createElement('div');
                menu.className = 'grid-context-menu';
                menu.innerHTML = [
                    '<button type="button" data-action="copy-cell">Copy Cell</button>',
                    '<button type="button" data-action="copy-selected">Copy Selected</button>',
                    '<button type="button" data-action="select-row">Select Row</button>',
                    '<button type="button" data-action="clear-selection">Clear Selection</button>',
                ].join('');

                const onAction = (action) => {
                    if (action === 'copy-cell') {
                        copyTextToClipboard(cell.textContent || '');
                    } else if (action === 'copy-selected') {
                        copySelectedCells();
                    } else if (action === 'select-row') {
                        selectEntireRow(rc.row);
                    } else if (action === 'clear-selection') {
                        state.selectedCells.clear();
                        updateSelectionDisplay();
                    }
                    hideGridContextMenu();
                };

                menu.addEventListener('click', (menuEvent) => {
                    const button = menuEvent.target.closest('button[data-action]');
                    if (!button) {
                        return;
                    }
                    onAction(button.dataset.action);
                });

                document.body.appendChild(menu);
                gridContextMenu = menu;

                const maxLeft = Math.max(0, window.innerWidth - menu.offsetWidth - 4);
                const maxTop = Math.max(0, window.innerHeight - menu.offsetHeight - 4);
                menu.style.left = `${Math.min(event.clientX, maxLeft)}px`;
                menu.style.top = `${Math.min(event.clientY, maxTop)}px`;
            });

            document.addEventListener('mouseup', () => {
                state.gridDragging = false;
            });

            document.addEventListener('mousedown', (event) => {
                if (!gridContextMenu) {
                    return;
                }
                if (event.target.closest('.grid-context-menu')) {
                    return;
                }
                hideGridContextMenu();
            });

            // Keyboard interactions
            grid.addEventListener('keydown', (event) => {
                if (!state.activeCell) {
                    return;
                }

                const handledKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
                if (!handledKeys.has(event.key) && !(event.ctrlKey && event.key.toUpperCase() === 'A')) {
                    return;
                }

                const allCells = Array.from(grid.querySelectorAll('td, .virtual-grid-td')).map((cell) => getRowCol(cell)).filter(Boolean);
                if (!allCells.length) {
                    return;
                }

                const maxRow = Math.max(...allCells.map((rc) => rc.row));
                const maxCol = Math.max(...allCells.map((rc) => rc.col));

                let newRow = state.activeCell.row;
                let newCol = state.activeCell.col;

                if (event.key === 'ArrowUp') {
                    newRow = Math.max(0, newRow - 1);
                } else if (event.key === 'ArrowDown') {
                    newRow = Math.min(maxRow, newRow + 1);
                } else if (event.key === 'ArrowLeft') {
                    newCol = Math.max(0, newCol - 1);
                } else if (event.key === 'ArrowRight') {
                    newCol = Math.min(maxCol, newCol + 1);
                } else if (event.key === 'Home') {
                    newCol = 0;
                } else if (event.key === 'End') {
                    newCol = maxCol;
                } else if (event.key === 'PageUp') {
                    newRow = Math.max(0, newRow - 10);
                } else if (event.key === 'PageDown') {
                    newRow = Math.min(maxRow, newRow + 10);
                } else if (event.ctrlKey && event.key.toUpperCase() === 'A') {
                    event.preventDefault();
                    state.selectedCells.clear();
                    allCells.forEach((rc) => {
                        state.selectedCells.add(getCellKey(rc.row, rc.col));
                    });
                    updateSelectionDisplay();
                    return;
                }

                if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    selectRange(state.activeCell, { row: newRow, col: newCol });
                } else {
                    state.selectedCells.clear();
                    state.selectedCells.add(getCellKey(newRow, newCol));
                    setActiveCell(newRow, newCol);
                }

                event.preventDefault();
            });

            // Auto-activate first cell if no active cell set
            if (!state.activeCell) {
                const firstCell = grid.querySelector('td, .virtual-grid-td');
                if (firstCell) {
                    const rc = getRowCol(firstCell);
                    if (rc) {
                        setActiveCell(rc.row, rc.col);
                    }
                }
            }


            updateSelectionDisplay();
        }

        function bringActiveCellIntoView(container) {
            if (!state.activeCell) {
                return;
            }

            const cell = container.querySelector(`[data-row="${state.activeCell.row}"][data-col="${state.activeCell.col}"]`);
            if (!cell) {
                return;
            }

            const body = container.querySelector('.virtual-grid-body');
            if (body) {
                const cellRect = cell.getBoundingClientRect();
                const bodyRect = body.getBoundingClientRect();

                if (cellRect.top < bodyRect.top) {
                    body.scrollTop -= bodyRect.top - cellRect.top;
                } else if (cellRect.bottom > bodyRect.bottom) {
                    body.scrollTop += cellRect.bottom - bodyRect.bottom;
                }
            }
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

            const applyTopPx = (nextTop) => {
                layout.style.gridTemplateRows = `${nextTop}px ${splitterHeight}px minmax(${minBottom}px, 1fr)`;
            };

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
                applyTopPx(nextTop);
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
                layout.style.gridTemplateRows = '';
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
            const startedAt = new Date();
            const startedAtText = formatDateTime(startedAt);
            setStatus('Running query…', state.currentDatabase.name);
            target.className = 'status-box';
            target.textContent = '실행 중...';
            outputLog(`QUERY START at=${startedAtText} db=${state.currentDatabase.name}`);
            outputLog(`QUERY SQL ${sql.replace(/\s+/g, ' ').trim().slice(0, 180)}`);

            try {
                const data = await requestJson('/api/query/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: state.currentDatabase.path, sql }),
                });
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
