// @ts-nocheck
/**
 * app.explorer.js - File Explorer
 * 파일 탐색 관련 기능
 */

/** 백그라운드 로딩 취소 제어용 카운터. loadTree 호출마다 증가해 이전 bg 루프를 무효화한다. */
let _explorerBgGeneration = 0;

/**
 * 파일 탐색기 렌더링
 */
function renderExplorer(treeData, append = false) {
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
    if (!append && treeData.parent_path) {
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
                    <span class="explorer-name" title="${escapeHtml(entry.name || '')}">${highlightExplorerName(entry.name, state.explorerFilter)}</span>
                </div>
                <div class="explorer-size">${escapeHtml(sizeText)}</div>
                <div class="explorer-modified">${escapeHtml(entry.modified_at || '')}</div>
            </div>
        `;
    }).join('');

    if (append) {
        domElements.explorerList.insertAdjacentHTML('beforeend', rows);
    } else {
        domElements.explorerList.innerHTML = head + rows;
    }
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
async function loadTree(path = '', offset = 0, append = false) {
    // 새 디렉터리 탐색 시 이전 백그라운드 로딩 취소
    if (!append) {
        _explorerBgGeneration++;
    }

    try {
        // 첫 로드는 200개로 빠르게, 이후 청크는 500개씩
        const limit = (offset === 0 && !append) ? 200 : 500;
        const url = `/api/tree/?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}`;
        const data = /** @type {any} */ (await requestJson(url));
        
        // 새로운 경로이거나 처음 로드인 경우 초기화
        if (offset === 0 || !append) {
            state.currentPath = data.current_path;
            state.lastTreeData = { ...data };
            // 다음 청크 시작 오프셋 (= 실제로 반환된 항목 수)
            state.explorerPaginationOffset = Array.isArray(data.entries) ? data.entries.length : 0;
        } else {
            // 기존 entries에 새 entries 추가
            if (state.lastTreeData) {
                state.lastTreeData.entries.push(...(Array.isArray(data.entries) ? data.entries : []));
            }
            state.explorerPaginationOffset = offset + (Array.isArray(data.entries) ? data.entries.length : 0);
        }
        
        const displayPath = data.current_abs_path || `repository${data.current_path ? `/${data.current_path}` : ''}`;
        domElements.currentPath.textContent = displayPath;
        outputLog(`DIR ${domElements.currentPath.textContent}`);
        
        // 권한 거부 경고 처리
        if (data.warning) {
            outputLog(`DIR WARNING ${data.warning}`, 'warn');
        }

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

        // Pagination 정보 저장
        state.explorerTotalEntries = data.total_entries || 0;
        state.explorerHasMore = data.has_more || false;
        
        renderExplorer(data, append);

        // 첫 로드 완료 후 나머지를 백그라운드로 자동 로딩
        if (!append && data.has_more) {
            const bgGen = _explorerBgGeneration;
            const bgPath = /** @type {string} */ (data.current_path);
            const bgOffset = state.explorerPaginationOffset;
            const bgTotal = data.total_entries || 0;
            _explorerBackgroundLoad(bgPath, bgOffset, bgTotal, bgGen);
        }
    } catch (error) {
        // @ts-ignore - error handling
        const errorMsg = error?.message || String(error);
        // @ts-ignore - error handling
        const statusCode = error?.statusCode;
        
        // 권한 거부 에러 처리
        if (statusCode === 403) {
            outputLog(`DIR ACCESS DENIED: ${errorMsg}. Please check permissions or try parent directory.`, 'error');
        } else {
            outputLog(`DIR ERROR ${errorMsg}`, 'error');
        }
        
        domElements.explorerList.innerHTML = `<div class="status-box error">${escapeHtml(errorMsg)}</div>`;
        domElements.explorerStatusbar.textContent = 'folders 0 | files 0 | size 0 B | disk 0%';
    }
}

/**
 * 백그라운드로 나머지 entries를 청크 단위로 불러온다.
 * generation 값이 바뀌면 즉시 중단한다 (디렉터리 이동 등).
 * @param {string} path
 * @param {number} startOffset
 * @param {number} total
 * @param {number} generation
 */
async function _explorerBackgroundLoad(path, startOffset, total, generation) {
    const CHUNK = 500;
    let offset = startOffset;

    while (offset < total) {
        if (_explorerBgGeneration !== generation) return;

        // UI 블로킹 방지를 위한 짧은 대기
        await new Promise((r) => setTimeout(r, 60));
        if (_explorerBgGeneration !== generation) return;

        try {
            const url = `/api/tree/?path=${encodeURIComponent(path)}&offset=${offset}&limit=${CHUNK}`;
            const data = /** @type {any} */ (await requestJson(url));

            if (_explorerBgGeneration !== generation) return;

            const newEntries = Array.isArray(data.entries) ? data.entries : [];
            if (newEntries.length === 0) break;

            if (state.lastTreeData && state.currentPath === path) {
                state.lastTreeData.entries.push(...newEntries);
                state.explorerPaginationOffset = offset + newEntries.length;
                state.explorerTotalEntries = data.total_entries || total;
                state.explorerHasMore = data.has_more || false;
                renderExplorer({ entries: newEntries }, true);
            }

            offset += newEntries.length;
            const loaded = offset;
            outputLog(`Explorer loading ${loaded.toLocaleString()} / ${(data.total_entries || total).toLocaleString()} files`);

            if (!data.has_more) break;
        } catch (err) {
            if (_explorerBgGeneration !== generation) return;
            // @ts-ignore
            outputLog(`Explorer background load error at offset ${offset}: ${err?.message || err}`, 'error');
            break;
        }
    }

    if (_explorerBgGeneration === generation) {
        outputLog(`Explorer all ${(state.explorerTotalEntries || total).toLocaleString()} files loaded`);
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

    // 무한 스크롤: 백그라운드 로딩 미완료 시 수동 보완용
    let scrollLoadPending = false;
    domElements.explorerList.addEventListener('scroll', (event) => {
        // 백그라운드 로딩 중이면 스킵
        if (scrollLoadPending || !state.explorerHasMore) {
            return;
        }

        const elem = /** @type {HTMLElement} */ (event.target);
        const threshold = 300;
        const isNearBottom = elem.scrollHeight - elem.scrollTop - elem.clientHeight < threshold;

        if (isNearBottom) {
            scrollLoadPending = true;
            const nextOffset = state.explorerPaginationOffset || 0;
            loadTree(state.currentPath, nextOffset, true).finally(() => {
                scrollLoadPending = false;
            });
        }
    });

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

    const activateExplorerRow = (row) => {
        const targetPath = row.dataset.path || '';
        if (row.dataset.type === 'parent' || row.dataset.type === 'directory') {
            outputLog(`NAV ${targetPath || '..'}`);
            loadTree(targetPath);
            return;
        }
        if (row.dataset.isSqlite === '1') {
            openDatabase(targetPath);
        }
    };

    domElements.explorerList.addEventListener('dblclick', (event) => {
        const target = /** @type {Element | null} */ (event.target instanceof Element ? event.target : null);
        const row = /** @type {HTMLElement | null} */ (target ? target.closest('.explorer-row') : null);
        if (!row) {
            return;
        }
        activateExplorerRow(row);
    });

    domElements.explorerList.addEventListener('keydown', (event) => {
        const handledKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' ', 'Spacebar', 'ArrowRight', 'ArrowLeft']);
        if (!handledKeys.has(event.key)) {
            return;
        }

        const rows = Array.from(domElements.explorerList.querySelectorAll('.explorer-row'));
        if (!rows.length) {
            return;
        }

        event.preventDefault();

        const selectRow = (row) => {
            domElements.explorerList.querySelectorAll('.explorer-row').forEach((item) => item.classList.remove('selected'));
            row.classList.add('selected');
            row.scrollIntoView({ block: 'start' });
            state.selectedExplorerPath = row.dataset.path || '';
        };

        const getSelectedOrFirstRow = () => {
            const selected = /** @type {HTMLElement | null} */ (rows.find((row) => row.classList.contains('selected')) || null);
            if (selected) {
                return selected;
            }
            const firstRow = /** @type {HTMLElement | null} */ (rows[0] || null);
            if (firstRow) {
                selectRow(firstRow);
            }
            return firstRow;
        };

        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            const selectedRow = getSelectedOrFirstRow();
            if (!selectedRow) {
                return;
            }
            activateExplorerRow(selectedRow);
            return;
        }

        if (event.key === 'ArrowRight') {
            const selectedRow = getSelectedOrFirstRow();
            if (!selectedRow) {
                return;
            }
            activateExplorerRow(selectedRow);
            return;
        }

        if (event.key === 'ArrowLeft') {
            const parentPath = String(state.lastTreeData?.parent_path || '');
            if (!parentPath) {
                return;
            }
            outputLog(`NAV ${parentPath || '..'}`);
            loadTree(parentPath);
            return;
        }

        const currentIndex = rows.findIndex((row) => row.classList.contains('selected'));
        let nextIndex = currentIndex;
        const rowHeight = rows[0] ? Math.max(1, Math.round(rows[0].getBoundingClientRect().height)) : 1;
        const pageStep = Math.max(1, Math.floor(domElements.explorerList.clientHeight / rowHeight) - 1);
        if (nextIndex < 0) {
            nextIndex = 0;
        } else if (event.key === 'Home') {
            nextIndex = 0;
            // Home 키일 때 스크롤을 맨 위로 이동
            domElements.explorerList.scrollTop = 0;
            // 가상화된 요소가 렌더링되도록 잠시 기다렸다가 rows 재계산
            requestAnimationFrame(() => {
                const updatedRows = Array.from(domElements.explorerList.querySelectorAll('.explorer-row'));
                if (updatedRows.length > 0) {
                    selectRow(updatedRows[0]);
                }
            });
            return;
        } else if (event.key === 'End') {
            nextIndex = rows.length - 1;
            // End 키일 때 스크롤을 맨 아래로 이동
            domElements.explorerList.scrollTop = domElements.explorerList.scrollHeight;
            // 가상화된 요소가 렌더링되도록 잠시 기다렸다가 rows 재계산
            requestAnimationFrame(() => {
                const updatedRows = Array.from(domElements.explorerList.querySelectorAll('.explorer-row'));
                if (updatedRows.length > 0) {
                    selectRow(updatedRows[updatedRows.length - 1]);
                }
            });
            return;
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

        selectRow(nextRow);

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
