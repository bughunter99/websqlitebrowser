/**
 * app.grid.js - Grid Rendering
 * 그리드/테이블 렌더링 관련 함수
 */

/**
 * 컬럼 기준으로 행 정렬
 */
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

/**
 * 헤더 텍스트 기반 초기 컬럼 너비 계산
 * 한글/중일문자는 약 14px, 영문은 약 8px로 계산
 */
function getInitialColumnWidthByHeader(headerText) {
    const text = String(headerText ?? '');
    let estimated = 24; // 기본 padding
    
    for (const char of text) {
        const code = char.charCodeAt(0);
        // 한글, 중문, 일문(CJK) 판단
        if ((code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
            (code >= 0x3040 && code <= 0x309F) ||  // Hiragana
            (code >= 0x30A0 && code <= 0x30FF) ||  // Katakana
            (code >= 0xAC00 && code <= 0xD7AF)) {  // Hangul
            estimated += 14;
        } else {
            estimated += 8;
        }
    }
    
    return Math.min(320, Math.max(80, estimated));
}

/**
 * HTML 테이블로 그리드 렌더링
 */
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

/**
 * 가상화된 그리드로 렌더링 (대용량 데이터)
 */
function renderVirtualizedTable(target, columns, rows, sortState = null) {
    if (!columns.length) {
        target.innerHTML = '<div class="empty-state">결과 컬럼이 없습니다.</div>';
        return;
    }

    const sortedRows = sortRowsByColumn(rows, columns, sortState);
    const rowHeight = 22;
    const overscan = 4;
    const columnWidths = [36, ...columns.map((column) => getInitialColumnWidthByHeader(column))];
    const minColumnWidth = 80;
    const getTemplateColumns = () => columnWidths.map((width) => `${width}px`).join(' ');
    const getTotalGridWidth = () => columnWidths.reduce((sum, width) => sum + width, 0);
    const applyTemplateColumns = () => {
        const template = getTemplateColumns();
        const totalWidth = getTotalGridWidth();
        const head = target.querySelector('.virtual-grid-head');
        if (head) {
            head.style.gridTemplateColumns = template;
            head.style.width = `${totalWidth}px`;
        }
        const spacer = target.querySelector('#virtual-grid-spacer');
        if (spacer) {
            spacer.style.width = `${totalWidth}px`;
        }
        const rowsLayer = target.querySelector('#virtual-grid-rows');
        if (rowsLayer) {
            rowsLayer.style.width = `${totalWidth}px`;
        }
        target.querySelectorAll('.virtual-grid-tr').forEach((rowEl) => {
            rowEl.style.gridTemplateColumns = template;
            rowEl.style.width = `${totalWidth}px`;
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
    const head = target.querySelector('.virtual-grid-head');
    const wrap = target.querySelector('.virtual-grid-wrap');
    if (!body || !spacer || !rowsLayer) {
        return;
    }

    const syncBodyHeight = () => {
        const wrapRect = wrap?.getBoundingClientRect();
        const headRect = head?.getBoundingClientRect();
        if (!wrapRect) {
            return;
        }

        const nextHeight = Math.max(120, Math.floor(wrapRect.height - (headRect?.height || 20)));
        body.style.height = `${nextHeight}px`;
        body.style.maxHeight = `${nextHeight}px`;
    };

    if (wrap) {
        wrap.dataset.maxRow = String(Math.max(0, sortedRows.length - 1));
        wrap.dataset.maxCol = String(Math.max(0, columns.length - 1));
        wrap.dataset.rowHeight = String(rowHeight);
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
            return `<div class="virtual-grid-tr" style="grid-template-columns:${getTemplateColumns()}; width:${getTotalGridWidth()}px;"><div class="virtual-grid-td row-index-cell">${rowIndex + 1}</div>${cells}</div>`;
        }).join('');

        // Virtualized rows are recreated on vertical scroll, so re-apply active/selected classes.
        if (typeof updateGridSelectionDisplay === 'function' && wrap === document.activeElement) {
            updateGridSelectionDisplay(wrap);
        }
    };

    const syncHeaderScroll = () => {
        if (!head) {
            return;
        }
        head.style.transform = `translateX(${-body.scrollLeft}px)`;
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

    body.addEventListener('scroll', () => {
        renderWindow();
        syncHeaderScroll();
    });

    syncBodyHeight();
    if (typeof ResizeObserver !== 'undefined' && wrap) {
        const resizeObserver = new ResizeObserver(() => {
            syncBodyHeight();
            renderWindow(true);
        });
        resizeObserver.observe(wrap);
        target._gridResizeObserver = resizeObserver;
    }

    applyTemplateColumns();
    syncHeaderScroll();
    renderWindow();
}

/**
 * 결과 콘텐츠 렌더링
 */
function renderResultContent(target, columns, rows) {
    const renderState = gridRenderState.get(target) || { sort: null };
    const sourceRows = Array.isArray(rows) ? rows : [];
    gridRenderState.set(target, { columns, rows: sourceRows, sort: renderState.sort || null });

        // 항상 가상화 그리드 사용 (Query 결과와 동일한 스타일)
        renderVirtualizedTable(target, columns, sourceRows, renderState.sort || null);
    initGridSorting(target);
}

/**
 * 그리드 정렬 초기화
 */
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

/**
 * 그리드 컬럼 리사이징 초기화
 */
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
