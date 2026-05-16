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
