// @ts-nocheck
/**
 * app.explorer.js - File Explorer
 * 파일 탐색 관련 기능
 */

/**
 * 파일 탐색기 렌더링
 */
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
        const selectedClass = state.selectedExplorerPath && state.selectedExplorerPath === entry.path ? ' selected' : '';
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

    domElements.explorerList.innerHTML = head + rows;
}

/**
 * 파일 탐색기 필터 설정
 */
function setExplorerFilter(value) {
    state.explorerFilter = String(value ?? '');
    if (state.lastTreeData) {
        renderExplorer(state.lastTreeData);
    }
}

/**
 * 파일 트리 로드
 */
async function loadTree(path = '') {
    try {
        const data = /** @type {any} */ (await requestJson(`/api/tree/?path=${encodeURIComponent(path)}`));
        state.currentPath = data.current_path;
        state.lastTreeData = data;
        const displayPath = data.current_abs_path || `repository${data.current_path ? `/${data.current_path}` : ''}`;
        domElements.currentPath.textContent = displayPath;
        outputLog(`DIR ${domElements.currentPath.textContent}`);
        const parentButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('go-parent'));
        if (parentButton) {
            parentButton.dataset.parentPath = data.parent_path;
            parentButton.disabled = !data.parent_path;
        }

        const stats = data.stats || {};
        const disk = stats.disk || {};
        domElements.explorerStatusbar.textContent = [
            `folders ${Number(stats.directories || 0)}`,
            `files ${Number(stats.files || 0)}`,
            `size ${stats.total_size_human || '0 B'}`,
            `disk ${Number(disk.used_percent || 0).toFixed(1)}%`,
        ].join(' | ');

        renderExplorer(data);
    } catch (error) {
        domElements.explorerList.innerHTML = `<div class="status-box error">${escapeHtml(error.message)}</div>`;
        domElements.explorerStatusbar.textContent = 'folders 0 | files 0 | size 0 B | disk 0%';
        outputLog(`DIR ERROR ${error.message}`, 'error');
    }
}

function wireExplorerPanel() {
    document.querySelectorAll('.nav-button').forEach((button) => {
        const navButton = /** @type {HTMLElement} */ (button);
        navButton.addEventListener('click', () => setPanel(navButton.dataset.target || 'explorer'));
    });

    const explorerFilter = document.getElementById('explorer-filter');
    if (explorerFilter) {
        explorerFilter.addEventListener('input', (event) => {
            const input = /** @type {HTMLInputElement} */ (event.target);
            setExplorerFilter(input.value || '');
        });
    }

    domElements.explorerList.addEventListener('click', (event) => {
        const target = /** @type {Element | null} */ (event.target instanceof Element ? event.target : null);
        const row = /** @type {HTMLElement | null} */ (target ? target.closest('.explorer-row') : null);
        if (!row) {
            return;
        }
        domElements.explorerList.focus();
        state.selectedExplorerPath = row.dataset.path || '';
        domElements.explorerList.querySelectorAll('.explorer-row').forEach((item) => item.classList.remove('selected'));
        row.classList.add('selected');

        if (row.dataset.type === 'file' && row.dataset.isSqlite === '1') {
            openDatabase(state.selectedExplorerPath);
        }
    });

    domElements.explorerList.addEventListener('dblclick', (event) => {
        const target = /** @type {Element | null} */ (event.target instanceof Element ? event.target : null);
        const row = /** @type {HTMLElement | null} */ (target ? target.closest('.explorer-row') : null);
        if (!row) {
            return;
        }

        const targetPath = row.dataset.path || '';
        if (row.dataset.type === 'parent' || row.dataset.type === 'directory') {
            outputLog(`NAV ${targetPath || '..'}`);
            loadTree(targetPath);
            return;
        }
        if (row.dataset.isSqlite === '1') {
            openDatabase(targetPath);
        }
    });

    domElements.explorerList.addEventListener('keydown', (event) => {
        const handledKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
        if (!handledKeys.has(event.key)) {
            return;
        }

        const rows = Array.from(domElements.explorerList.querySelectorAll('.explorer-row'));
        if (!rows.length) {
            return;
        }

        event.preventDefault();

        const currentIndex = rows.findIndex((row) => row.classList.contains('selected'));
        let nextIndex = currentIndex;
        const rowHeight = rows[0] ? Math.max(1, Math.round(rows[0].getBoundingClientRect().height)) : 1;
        const pageStep = Math.max(1, Math.floor(domElements.explorerList.clientHeight / rowHeight) - 1);
        if (nextIndex < 0) {
            nextIndex = 0;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = rows.length - 1;
        } else if (event.key === 'ArrowUp') {
            nextIndex = Math.max(0, nextIndex - 1);
        } else if (event.key === 'PageUp') {
            nextIndex = Math.max(0, nextIndex - pageStep);
        } else if (event.key === 'PageDown') {
            nextIndex = Math.min(rows.length - 1, nextIndex + pageStep);
        } else {
            nextIndex = Math.min(rows.length - 1, nextIndex + 1);
        }

        const nextRow = /** @type {HTMLElement | undefined} */ (rows[nextIndex]);
        if (!nextRow) {
            return;
        }

        domElements.explorerList.querySelectorAll('.explorer-row').forEach((row) => row.classList.remove('selected'));
        nextRow.classList.add('selected');
        nextRow.scrollIntoView({ block: 'nearest' });
        state.selectedExplorerPath = nextRow.dataset.path || '';

        if (nextRow.dataset.type === 'file' && nextRow.dataset.isSqlite === '1') {
            openDatabase(state.selectedExplorerPath);
        }
    });

    if (domElements.workspaceReload) {
        domElements.workspaceReload.addEventListener('click', () => {
            outputLog('NAV reload');
            loadTree(state.currentPath);
        });
    }
}
