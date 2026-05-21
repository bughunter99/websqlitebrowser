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

        const selectionStart = Number(sqlEditor.selectionStart || 0);
        const selectionEnd = Number(sqlEditor.selectionEnd || 0);

        let sql = '';
        if (selectionEnd > selectionStart) {
            // 선택 영역이 있으면 전체를 그대로 실행한다.
            sql = sqlEditor.value.slice(selectionStart, selectionEnd).trim();
        } else {
            // 선택이 없으면 캐럿 위치의 단일 문장만 실행한다.
            const caretPosition = selectionStart;
            const sqlStatements = sqlEditor.value.split(';');
            let currentSql = '';
            let position = 0;

            for (const statement of sqlStatements) {
                position += statement.length + 1; // 세미콜론 포함
                if (caretPosition <= position) {
                    currentSql = statement.trim();
                    break;
                }
            }

            sql = currentSql;
        }

        if (!sql) {
            target.className = 'status-box error';
            target.textContent = '실행할 SQL 문을 찾을 수 없습니다.';
            return;
        }

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
            // 캐시에서 결과 확인 (SELECT 문인 경우만)
            let data;
            let wasCached = false;
            const isCacheable = queryResultCache.shouldCache(sql);
            if (isCacheable) {
                const cachedResult = queryResultCache.get(sql, databasePath);
                if (cachedResult) {
                    data = cachedResult;
                    wasCached = true;
                    outputLog(`QUERY CACHE HIT request=${requestId}`, 'info');
                } else {
                    data = /** @type {QueryResponse} */ (await requestJson('/api/query/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: databasePath, sql }),
                    }));
                    // 캐시에 저장
                    queryResultCache.set(sql, databasePath, data);
                }
            } else {
                // 쓰기/시간의존 쿼리는 캐시하지 않음
                if (/^SELECT\s+/i.test(sql.trim()) && queryResultCache.isVolatileQuery(sql)) {
                    outputLog(`QUERY CACHE BYPASS request=${requestId} reason=volatile_sql`, 'info');
                }
                data = /** @type {QueryResponse} */ (await requestJson('/api/query/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: databasePath, sql }),
                }));
            }
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
                    // 각 쿼리별 메트릭 기록
                    performanceMetrics.recordQuery(sql, elapsedMs, Number(item.row_count || item.rows?.length || 0), wasCached, true);
                });
            } else {
                target.className = '';
                renderResultContent(target, data.columns, data.rows);
                attachGridInteractions(target);
                const fetchedRows = Number(data.row_count || 0);
                const truncatedText = data.truncated ? ' | Truncated' : '';
                setStatus(`Rows: ${fetchedRows}${truncatedText}`, `${elapsedMs} ms`);
                outputLog(`QUERY END request=${requestId} at=${finishedAtText} elapsed=${elapsedMs}ms rows=${fetchedRows}${data.truncated ? ' truncated=true' : ''}`);
                // 쿼리 메트릭 기록
                performanceMetrics.recordQuery(sql, elapsedMs, fetchedRows, wasCached, true);
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
            
            // 에러 시 해당 쿼리의 캐시 제거
            queryResultCache.cache.delete(queryResultCache.generateKey(sql, databasePath));
            outputLog(`QUERY ERROR request=${requestId} ${errorMsg} cache_removed=true`, 'error');
        } finally {
            setQueryPending(false);
            // 쓰기 쿼리인 경우 DB의 모든 캐시 초기화
            queryResultCache.clearIfWriteQuery(sql, databasePath);
        }
    } catch (outerError) {
        setQueryPending(false);
        outputLog(`QUERY UNEXPECTED ERROR ${outerError instanceof Error ? outerError.message : String(outerError)}`, 'error');
    }
}
