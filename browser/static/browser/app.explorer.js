// @ts-nocheck
/**
 * app.explorer.js - File Explorer
 * 파일 탐색 관련 기능
 */

/** 백그라운드 로딩 취소 제어용 카운터. loadTree 호출마다 증가해 이전 bg 루프를 무효화한다. */
let _explorerBgGeneration = 0;
const EXPLORER_INITIAL_LIMIT = 120;
const EXPLORER_CHUNK_LIMIT = 1000;
const EXPLORER_FILTER_SEARCH_LIMIT = 50;
const EXPLORER_FILTER_SEARCH_DEBOUNCE_MS = 220;

let _explorerFilterSearchTimer = null;
let _explorerFilterSearchSeq = 0;
let _explorerFilterSearchQuery = '';
let _explorerFilterSearchEntries = [];

function _setExplorerStatusbar(stats) {
    const safeStats = stats || {};
    const disk = safeStats.disk || {};
    domElements.explorerStatusbar.textContent = [
        `folders ${Number(safeStats.directories || 0)}`,
        `files ${Number(safeStats.files || 0)}`,
        `size ${safeStats.total_size_human || '0 B'}`,
        `disk ${Number(disk.used_percent || 0).toFixed(1)}%`,
    ].join(' | ');
}

function _countExplorerEntryTypes(entries) {
    let directories = 0;
    let files = 0;
    for (const entry of (Array.isArray(entries) ? entries : [])) {
        if (entry?.type === 'directory') {
            directories += 1;
        } else if (entry?.type === 'file') {
            files += 1;
        }
    }
    return { directories, files };
}

function _explorerProgressText(progress) {
    const clampLoaded = (loaded, total) => {
        const safeLoaded = Number(loaded || 0);
        const safeTotal = Number(total || 0);
        return safeTotal > 0 ? Math.min(safeLoaded, safeTotal) : safeLoaded;
    };
    const totalEntries = Number(progress.totalEntries || 0);
    const loadedEntries = clampLoaded(progress.loadedEntries, totalEntries);
    const totalDirectories = Number(progress.totalDirectories || 0);
    const totalFiles = Number(progress.totalFiles || 0);
    const loadedDirectories = clampLoaded(progress.loadedDirectories, totalDirectories);
    const loadedFiles = clampLoaded(progress.loadedFiles, totalFiles);
    const percent = totalEntries > 0 ? Math.min(100, (loadedEntries / totalEntries) * 100) : 100;
    const entriesText = `${loadedEntries.toLocaleString()} / ${totalEntries.toLocaleString()} entries (${percent.toFixed(1)}%)`;
    const foldersText = `folders ${loadedDirectories.toLocaleString()} / ${totalDirectories.toLocaleString()}`;
    const filesText = `files ${loadedFiles.toLocaleString()} / ${totalFiles.toLocaleString()}`;
    return `${entriesText} | ${foldersText} | ${filesText}`;
}

function _resetExplorerFilterSearch() {
    _explorerFilterSearchSeq += 1;
    _explorerFilterSearchQuery = '';
    _explorerFilterSearchEntries = [];
    if (_explorerFilterSearchTimer) {
        clearTimeout(_explorerFilterSearchTimer);
        _explorerFilterSearchTimer = null;
    }
}

function _hasLocalExplorerFilterMatch(filterQuery) {
    const localEntries = Array.isArray(state.lastTreeData?.entries) ? state.lastTreeData.entries : [];
    return localEntries.some((entry) => String(entry?.name || '').toLowerCase().includes(filterQuery));
}

function _renderExplorerWithCurrentState() {
    if (!state.lastTreeData) {
        return;
    }
    renderExplorer(state.lastTreeData);
}

async function _runExplorerFilterSearch(filterQuery) {
    const currentQuery = String(filterQuery || '').trim().toLowerCase();
    outputLog(`FILTER SEARCH start query="${currentQuery}" path="${state.currentPath}"`);
    if (!currentQuery || currentQuery.length < 2 || !state.lastTreeData) {
        outputLog(`FILTER SEARCH skip: query too short or no tree data`);
        _resetExplorerFilterSearch();
        _renderExplorerWithCurrentState();
        return;
    }

    const localCount = Array.isArray(state.lastTreeData?.entries)
        ? state.lastTreeData.entries.filter((e) => String(e?.name || '').toLowerCase().includes(currentQuery)).length
        : 0;
    outputLog(`FILTER SEARCH local match count=${localCount}`);
    if (_hasLocalExplorerFilterMatch(currentQuery)) {
        outputLog(`FILTER SEARCH local match found, skip API`);
        _resetExplorerFilterSearch();
        _renderExplorerWithCurrentState();
        return;
    }

    const requestSeq = _explorerFilterSearchSeq + 1;
    _explorerFilterSearchSeq = requestSeq;
    const url = `/api/tree/search/?path=${encodeURIComponent(state.currentPath)}&q=${encodeURIComponent(currentQuery)}&limit=${EXPLORER_FILTER_SEARCH_LIMIT}`;
    outputLog(`FILTER SEARCH API call: ${url}`);
    try {
        const data = /** @type {any} */ (await requestJson(url));
        outputLog(`FILTER SEARCH API response: count=${data?.count} entries=${JSON.stringify((data?.entries || []).slice(0, 3).map((e) => e?.path))}`);
        if (requestSeq !== _explorerFilterSearchSeq) {
            outputLog(`FILTER SEARCH stale seq, discard`);
            return;
        }
        const latestFilter = String(state.explorerFilter || '').trim().toLowerCase();
        if (latestFilter !== currentQuery) {
            outputLog(`FILTER SEARCH filter changed (now="${latestFilter}"), discard`);
            return;
        }
        _explorerFilterSearchQuery = currentQuery;
        _explorerFilterSearchEntries = Array.isArray(data.entries) ? data.entries : [];
        _renderExplorerWithCurrentState();
        outputLog(`FILTER SEARCH done: matched ${_explorerFilterSearchEntries.length} nested entries for "${currentQuery}"`);
    } catch (error) {
        if (requestSeq !== _explorerFilterSearchSeq) {
            return;
        }
        // @ts-ignore
        outputLog(`FILTER SEARCH error: ${error?.message || error}`, 'error');
        _explorerFilterSearchQuery = currentQuery;
        _explorerFilterSearchEntries = [];
        _renderExplorerWithCurrentState();
    }
}

function _scheduleExplorerFilterSearch() {
    if (_explorerFilterSearchTimer) {
        clearTimeout(_explorerFilterSearchTimer);
        _explorerFilterSearchTimer = null;
    }

    const query = String(state.explorerFilter || '').trim().toLowerCase();
    outputLog(`FILTER SCHEDULE query="${query}" len=${query.length}`);
    if (!query || query.length < 2) {
        outputLog(`FILTER SCHEDULE skip: query too short`);
        _resetExplorerFilterSearch();
        _renderExplorerWithCurrentState();
        return;
    }

    outputLog(`FILTER SCHEDULE debounce set ${EXPLORER_FILTER_SEARCH_DEBOUNCE_MS}ms`);
    _explorerFilterSearchTimer = setTimeout(() => {
        _explorerFilterSearchTimer = null;
        outputLog(`FILTER SCHEDULE debounce fired for "${query}"`);
        _runExplorerFilterSearch(query);
    }, EXPLORER_FILTER_SEARCH_DEBOUNCE_MS);
}

/**
 * 파일 탐색기 렌더링
 */
function renderExplorer(treeData, append = false, startOffset = 0) {
    const entries = Array.isArray(treeData.entries) ? treeData.entries : [];
    const hasParent = Boolean(treeData.has_parent);
    const filterQuery = String(state.explorerFilter || '').trim().toLowerCase();
    const head = `
        <div class="explorer-head">
            <div class="explorer-order-head">No.<span class="explorer-col-resizer" data-col="order" data-dir="1"></span></div>
            <div>Name<span class="explorer-col-resizer" data-col="size" data-dir="-1"></span></div>
            <div style="text-align: right;">Size<span class="explorer-col-resizer" data-col="size" data-dir="1"></span></div>
            <div style="text-align: right;">Modified</div>
        </div>
    `;

    const allEntries = [];
    if (!append && hasParent) {
        allEntries.push({
            name: '../',
            path: treeData.parent_path || '',
            type: 'parent',
            is_sqlite: false,
            size_human: '',
            modified_at: '',
        });
    }
    const numberedEntries = entries.map((entry, index) => ({
        ...entry,
        _orderNo: Number(startOffset) + index + 1,
    }));
    const filteredEntries = filterQuery
        ? numberedEntries.filter((entry) => String(entry.name || '').toLowerCase().includes(filterQuery))
        : numberedEntries;
    allEntries.push(...filteredEntries);

    if (!append && filterQuery && filteredEntries.length === 0 && _explorerFilterSearchQuery === filterQuery) {
        const mappedSearchEntries = _explorerFilterSearchEntries.map((entry) => ({
            ...entry,
            name: `${entry.parent_dir || ''}/${entry.name || ''}`.replace(/^\//, ''),
            _isFilterSearchResult: true,
        }));
        allEntries.push(...mappedSearchEntries);
    }

    const rows = allEntries.map((entry) => {
        const sizeText = entry.type === 'file' ? (entry.size_human || '0 B') : '';
        const orderText = entry.type === 'parent' || !Number.isFinite(Number(entry._orderNo))
            ? ''
            : Number(entry._orderNo).toLocaleString();
        const selectedClass = String(state.selectedExplorerPath ?? '') === String(entry.path ?? '') ? ' selected' : '';
        const parentClass = entry.type === 'parent' ? ' parent-row' : '';
        const searchClass = entry._isFilterSearchResult ? ' explorer-search-result' : '';
        return `
            <div class="explorer-row${selectedClass}${parentClass}${searchClass}" data-path="${escapeHtml(entry.path)}" data-type="${escapeHtml(entry.type)}" data-is-sqlite="${entry.is_sqlite ? '1' : '0'}">
                <div class="explorer-order">${escapeHtml(orderText)}</div>
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
    outputLog(`FILTER SET value="${state.explorerFilter}"`);
    if (state.lastTreeData) {
        renderExplorer(state.lastTreeData);
    }
    _scheduleExplorerFilterSearch();
}

/**
 * 파일 트리 로드
 */
async function loadTree(path = '', offset = 0, append = false) {
    // 새 디렉터리 탐색 시 이전 백그라운드 로딩 취소
    if (!append) {
        _explorerBgGeneration++;
        _resetExplorerFilterSearch();
    }

    try {
        // 첫 화면은 빠르게, 이후는 큰 청크로 백그라운드 로딩
        const limit = (offset === 0 && !append) ? EXPLORER_INITIAL_LIMIT : EXPLORER_CHUNK_LIMIT;
        const url = `/api/tree/?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}`;
        const data = /** @type {any} */ (await requestJson(url));
        
        // 새로운 경로이거나 처음 로드인 경우 초기화
        if (offset === 0 || !append) {
            state.currentPath = data.current_path;
            state.lastTreeData = { ...data };
            // 다음 청크 시작 오프셋 (서버 기준 next_offset 우선 사용)
            const nextOffset = Number(data.next_offset);
            state.explorerPaginationOffset = Number.isFinite(nextOffset)
                ? nextOffset
                : (Array.isArray(data.entries) ? data.entries.length : 0);
        } else {
            // 기존 entries에 새 entries 추가
            if (state.lastTreeData) {
                state.lastTreeData.entries.push(...(Array.isArray(data.entries) ? data.entries : []));
            }
            const nextOffset = Number(data.next_offset);
            state.explorerPaginationOffset = Number.isFinite(nextOffset)
                ? nextOffset
                : (offset + (Array.isArray(data.entries) ? data.entries.length : 0));
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
            parentButton.disabled = !Boolean(data.has_parent);
        }

        const stats = data.stats || {};
        _setExplorerStatusbar(stats);
        if (stats.partial) {
            outputLog(`DIR STATS sampled=${Number(stats.scanned_entries || 0)} limit=${Number(stats.scan_limit || 0)} (partial)`, 'info');
        }

        // Pagination 정보 저장
        state.explorerTotalEntries = data.total_entries || 0;
        state.explorerHasMore = data.has_more || false;
        
        renderExplorer(data, append, offset);
        if (!append) {
            _scheduleExplorerFilterSearch();
        }

        // 첫 로드 완료 후 나머지를 백그라운드로 자동 로딩
        if (!append && data.has_more) {
            const bgGen = _explorerBgGeneration;
            const bgPath = /** @type {string} */ (data.current_path);
            const bgOffset = state.explorerPaginationOffset;
            const bgTotal = data.total_entries || 0;
            const initialTypeCount = _countExplorerEntryTypes(data.entries);
            const progress = {
                loadedEntries: Math.min(bgOffset, bgTotal),
                totalEntries: bgTotal,
                loadedDirectories: initialTypeCount.directories,
                loadedFiles: initialTypeCount.files,
                totalDirectories: Number(stats.directories || 0),
                totalFiles: Number(stats.files || 0),
            };
            outputLog(`Explorer background loading started: ${_explorerProgressText(progress)}`);
            _explorerBackgroundLoad(bgPath, bgOffset, bgTotal, bgGen, progress);
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
 * @param {{loadedEntries:number,totalEntries:number,loadedDirectories:number,loadedFiles:number,totalDirectories:number,totalFiles:number}} progress
 */
async function _explorerBackgroundLoad(path, startOffset, total, generation, progress) {
    const CHUNK = EXPLORER_CHUNK_LIMIT;
    let offset = startOffset;
    let lastProgressLogAt = 0;

    while (offset < total) {
        if (_explorerBgGeneration !== generation) return;

        // UI 블로킹 방지를 위한 짧은 대기
        await new Promise((r) => setTimeout(r, 10));
        if (_explorerBgGeneration !== generation) return;

        try {
            const url = `/api/tree/?path=${encodeURIComponent(path)}&offset=${offset}&limit=${CHUNK}`;
            const data = /** @type {any} */ (await requestJson(url));

            if (_explorerBgGeneration !== generation) return;

            const newEntries = Array.isArray(data.entries) ? data.entries : [];
            if (newEntries.length === 0) break;
            const nextOffset = Number(data.next_offset);
            let resolvedNextOffset = Number.isFinite(nextOffset) ? nextOffset : (offset + newEntries.length);
            if (resolvedNextOffset <= offset) {
                resolvedNextOffset = offset + newEntries.length;
            }
            const newTypeCount = _countExplorerEntryTypes(newEntries);
            progress.loadedDirectories += newTypeCount.directories;
            progress.loadedFiles += newTypeCount.files;

            if (state.lastTreeData && state.currentPath === path) {
                state.lastTreeData.entries.push(...newEntries);
                state.explorerPaginationOffset = resolvedNextOffset;
                state.explorerTotalEntries = data.total_entries || total;
                state.explorerHasMore = data.has_more || false;
                if (newEntries.length > 0) {
                    renderExplorer({ entries: newEntries }, true, offset);
                }
            }

            offset = resolvedNextOffset;
            const loaded = offset;
            progress.loadedEntries = loaded;
            progress.totalEntries = data.total_entries || total;
            if (loaded - lastProgressLogAt >= CHUNK || !data.has_more) {
                outputLog(`Explorer loading ${_explorerProgressText(progress)}`);
                lastProgressLogAt = loaded;
            }

            if (!data.has_more) break;
        } catch (err) {
            if (_explorerBgGeneration !== generation) return;
            // @ts-ignore
            outputLog(`Explorer background load error at offset ${offset}: ${err?.message || err}`, 'error');
            break;
        }
    }

    if (_explorerBgGeneration === generation) {
        progress.loadedEntries = state.explorerTotalEntries || total;
        outputLog(`Explorer all loaded: ${_explorerProgressText(progress)}`);
    }
}

function wireExplorerPanel() {
    _wireExplorerColumnResize();

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
            const hasParent = Boolean(state.lastTreeData?.has_parent);
            if (!hasParent) {
                return;
            }
            const parentPath = String(state.lastTreeData?.parent_path || '');
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
                    const parentRow = updatedRows.find((row) => row.dataset.type === 'parent');
                    selectRow(parentRow || updatedRows[0]);
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

function _wireExplorerColumnResize() {
    const list = domElements.explorerList;
    const COL_DEFAULTS = { order: 56, size: 90, modified: 130 };
    const COL_MIN = { order: 30, size: 50, modified: 70 };

    list.addEventListener('mousedown', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const resizer = /** @type {HTMLElement|null} */ (target ? target.closest('.explorer-col-resizer') : null);
        if (!resizer) return;

        event.preventDefault();
        event.stopPropagation();
        const col = resizer.dataset.col;
        if (!col) return;

        resizer.classList.add('resizing');
        const propName = `--col-${col}-w`;
        const currentVal = list.style.getPropertyValue(propName);
        const startWidth = currentVal ? parseInt(currentVal, 10) : (COL_DEFAULTS[col] || 80);
        const startX = event.clientX;

        const dir = parseInt(resizer.dataset.dir || '1', 10);
        const onMove = (e) => {
            const delta = e.clientX - startX;
            const newWidth = Math.max(COL_MIN[col] || 40, startWidth + dir * delta);
            list.style.setProperty(propName, `${newWidth}px`);
        };
        const onUp = () => {
            resizer.classList.remove('resizing');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
