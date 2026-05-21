/**
 * app.db.js - Database Operations
 * DB 오픈/테이블 로드 컨트롤러
 */

async function openDatabase(path) {
    try {
        const data = /** @type {any} */ (await requestJson(`/api/database/?path=${encodeURIComponent(path)}`));
        state.currentDatabase = data.database;
        state.loadedTables.clear();
        state.tableLoadRequestIds.clear();
        
        // 이전 DB의 캐시 제거
        if (path) {
            queryResultCache.clearByDatabase(path);
        }

        domElements.workspaceFile.textContent = data.database.name;
        setStatus(`Opened: ${data.database.name}`, `Tables: ${data.database.tables.length}`);
        outputLog(`OPEN ${data.database.path}`);
        resetWorkspaceTabs();

        state.tableTabIds = buildDatabaseTabs(data.database.tables, (tableName, tabId) => {
            activateTab(tabId);
            loadTable(tableName, tabId);
        });

        initQueryPane();

        const sqlEditor = document.getElementById('sql-editor');
        if (sqlEditor instanceof HTMLTextAreaElement) {
            const firstTableName = Array.isArray(data.database.tables) && data.database.tables.length
                ? String(data.database.tables[0].name || '').trim()
                : '';
            if (firstTableName) {
                sqlEditor.value = `SELECT name FROM ${firstTableName};`;
            } else {
                sqlEditor.value = '';
            }
            sqlEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }

        activateTab('query');
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setStatus('Open database failed', errorMsg);
        outputLog(`OPEN ERROR ${errorMsg}`, 'error');
    }
}
