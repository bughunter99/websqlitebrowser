/**
 * app.query.js - Query Execution
 * SQL 실행 및 결과 렌더링
 */

/** @typedef {{ [key: string]: unknown }} QueryRow */
/** @typedef {{ columns?: string[], rows?: QueryRow[], row_count?: number, truncated?: boolean, results?: QueryResult[] }} QueryResponse */

function setQueryPending(isPending) {
    const editor = document.getElementById('sql-editor');
    if (editor instanceof HTMLTextAreaElement) {
        editor.readOnly = isPending;
        editor.classList.toggle('is-pending', isPending);
    }
    state.queryPending = isPending;
}

async function runQuery() {
    const target = document.getElementById('query-result');
    if (!target) {
        return;
    }

    if (state.queryPending) {
        outputLog('QUERY SKIP pending=true', 'warn');
        return;
    }

    try {
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

        const sqlEditor = document.getElementById('sql-editor');
        if (!(sqlEditor instanceof HTMLTextAreaElement)) {
            target.className = 'status-box error';
            target.textContent = 'SQL 에디터를 찾을 수 없습니다.';
            return;
        }

        const sql = sqlEditor.value;
        const databasePath = state.currentDatabase.path;
        const requestId = state.queryRequestSeq + 1;
        state.queryRequestSeq = requestId;
        state.activeQueryRequestId = requestId;

        const isStaleQueryResponse = () => {
            return state.activeQueryRequestId !== requestId
                || !state.currentDatabase
                || state.currentDatabase.path !== databasePath;
        };

        const startedAt = new Date();
        const startedAtText = formatDateTime(startedAt);
        setStatus('Running query…', state.currentDatabase.name);
        target.className = 'status-box';
        target.textContent = '실행 중...';
        outputLog(`QUERY START request=${requestId} at=${startedAtText} db=${state.currentDatabase.name}`);
        outputLog(`QUERY SQL request=${requestId} ${sql.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
        setQueryPending(true);

        try {
            const data = /** @type {QueryResponse} */ (await requestJson('/api/query/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: databasePath, sql }),
            }));
            if (isStaleQueryResponse()) {
                outputLog(`QUERY STALE IGNORED request=${requestId} elapsed=${Date.now() - startedAt.getTime()}ms`, 'warn');
                return;
            }

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
                outputLog(`QUERY END request=${requestId} at=${finishedAtText} elapsed=${elapsedMs}ms results=${data.results.length} rows=${totalRows}`);
                data.results.forEach((item, index) => {
                    outputLog(`RESULT request=${requestId} ${index + 1} rows=${Number(item.row_count || item.rows?.length || 0)}${item.truncated ? ' truncated=true' : ''}`);
                });
            } else {
                target.className = '';
                renderResultContent(target, data.columns, data.rows);
                attachGridInteractions(target);
                const fetchedRows = Number(data.row_count || 0);
                const truncatedText = data.truncated ? ' | Truncated' : '';
                setStatus(`Rows: ${fetchedRows}${truncatedText}`, `${elapsedMs} ms`);
                outputLog(`QUERY END request=${requestId} at=${finishedAtText} elapsed=${elapsedMs}ms rows=${fetchedRows}${data.truncated ? ' truncated=true' : ''}`);
            }
        } catch (error) {
            if (isStaleQueryResponse()) {
                outputLog(`QUERY STALE ERROR IGNORED request=${requestId} elapsed=${Date.now() - startedAt.getTime()}ms`, 'warn');
                return;
            }
            target.className = 'status-box error';
            // @ts-ignore - error object has message property
            const errorMsg = error?.message || String(error);
            target.textContent = errorMsg;
            setStatus('Query failed', errorMsg);
            outputLog(`QUERY ERROR request=${requestId} ${errorMsg}`, 'error');
        } finally {
            setQueryPending(false);
        }
    } catch (outerError) {
        setQueryPending(false);
        outputLog(`QUERY UNEXPECTED ERROR ${outerError instanceof Error ? outerError.message : String(outerError)}`, 'error');
    }
}
