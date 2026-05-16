// @ts-nocheck
/**
 * app.table.controller.js - Table Data Controller
 * 테이블 데이터 조회/상태 전이
 */

async function loadTable(tableName, tabId = state.tableTabIds.get(tableName)) {
    if (!state.currentDatabase || !tabId || state.loadedTables.has(tableName)) {
        return;
    }

    const target = getTableResultTarget(tabId);
    if (!target) {
        return;
    }

    const databasePath = state.currentDatabase.path;
    const requestId = state.tableLoadRequestSeq + 1;
    state.tableLoadRequestSeq = requestId;
    state.tableLoadRequestIds.set(tableName, requestId);
    const startedAt = Date.now();

    outputLog(`TABLE START ${tableName} request=${requestId}`);

    setTableLoadingState(target);

    try {
        // 캐시 확인 (SELECT * FROM table)
        const query = `SELECT * FROM ${tableName}`;
        let data;
        const cachedResult = queryResultCache.get(query, databasePath);
        if (cachedResult) {
            data = cachedResult;
            outputLog(`TABLE CACHE HIT ${tableName} request=${requestId}`, 'info');
        } else {
            data = /** @type {any} */ (await requestJson(`/api/table/?path=${encodeURIComponent(databasePath)}&table=${encodeURIComponent(tableName)}&all=1`));
            // 캐시에 저장
            queryResultCache.set(query, databasePath, data);
        }
        
        const isStale = state.tableLoadRequestIds.get(tableName) !== requestId
            || !state.currentDatabase
            || state.currentDatabase.path !== databasePath;
        if (isStale) {
            outputLog(`TABLE STALE IGNORED ${tableName} request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
            return;
        }
        renderTableResultState(target, data.columns, data.rows);
        state.loadedTables.set(tableName, true);
        outputLog(`TABLE END ${tableName} request=${requestId} elapsed=${Date.now() - startedAt}ms rows=${Number(data.row_count || data.rows?.length || 0)}`);
    } catch (error) {
        const isStale = state.tableLoadRequestIds.get(tableName) !== requestId
            || !state.currentDatabase
            || state.currentDatabase.path !== databasePath;
        if (isStale) {
            outputLog(`TABLE STALE ERROR IGNORED ${tableName} request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
            return;
        }
        // @ts-ignore - error.message is safe to access
        renderTableErrorState(target, error?.message || String(error));
        // @ts-ignore - error.message is safe to access
        outputLog(`TABLE ERROR ${tableName} request=${requestId} elapsed=${Date.now() - startedAt}ms ${error?.message || String(error)}`, 'error');
    }
}
