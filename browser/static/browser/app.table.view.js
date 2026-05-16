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

function renderTableResultState(target, columns, rows) {
    target.className = '';
    renderResultContent(target, columns, rows);
    attachGridInteractions(target);
}

function renderTableErrorState(target, message) {
    target.className = 'status-box error';
    target.textContent = message;
}
