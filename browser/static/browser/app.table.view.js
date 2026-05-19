/**
 * app.table.view.js - Table View Helpers
 * 테이블 탭 상태/렌더링 전용
 */

function getTableResultTarget(tabId) {
    return document.getElementById(`table-result-${tabId}`);
}

function setTableLoadingState(target) {
    target.className = 'status-box';
    target.textContent = '로딩 중...';
}

function renderTableResultState(target, columns, rows, options = {}) {
    target.className = '';
    const rowCount = Number(options.rowCount || rows?.length || 0);
    const limit = Number(options.limit || 0);
    const truncated = Boolean(options.truncated);

    if (truncated && limit > 0) {
        target.innerHTML = `<div class="table-result-notice">Rows: ${rowCount} / capped at ${limit}</div>`;
        const gridHost = document.createElement('div');
        target.appendChild(gridHost);
        renderResultContent(gridHost, columns, rows);
    } else {
        renderResultContent(target, columns, rows);
    }
    attachGridInteractions(target);
}

function renderTableErrorState(target, message) {
    target.className = 'status-box error';
    target.textContent = message;
}
