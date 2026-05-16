/**
 * app.utils.js - Utility Functions
 * 공통 유틸리티 함수들
 */

/**
 * 그리드 컨텍스트 메뉴 숨기기
 */
function hideGridContextMenu() {
    if (gridContextMenu) {
        gridContextMenu.remove();
        gridContextMenu = null;
    }
}

/**
 * 텍스트를 클립보드에 복사
 */
function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        });
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

/**
 * 선택된 Explorer 행 가져오기
 */
function getSelectedExplorerRow() {
    return domElements.explorerList.querySelector('.explorer-row.selected');
}

/**
 * 상태바 텍스트 설정
 */
function setStatus(leftText, rightText) {
    const statusLeft = document.getElementById('status-left');
    const statusRight = document.getElementById('status-right');
    if (statusLeft && leftText !== undefined) {
        statusLeft.textContent = leftText;
    }
    if (statusRight && rightText !== undefined) {
        statusRight.textContent = rightText;
    }
}

/**
 * Output 창에 로그 추가
 */
function outputLog(message, level = 'info') {
    if (!domElements.outputBody) {
        return;
    }
    const now = new Date();
    const pad = (number) => String(number).padStart(2, '0');
    const stamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
    ].join('') + ' ' + [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('');
    const line = document.createElement('div');
    line.className = `output-line${level === 'info' ? '' : ` ${level}`}`;
    line.textContent = `${stamp} ${message}`;
    domElements.outputBody.appendChild(line);

    const maxLines = 300;
    while (domElements.outputBody.childElementCount > maxLines) {
        domElements.outputBody.removeChild(domElements.outputBody.firstElementChild);
    }
    domElements.outputBody.scrollTop = domElements.outputBody.scrollHeight;
}

/**
 * 날짜시간을 포맷팅 (YYYY-MM-DD HH:MM:SS)
 */
function formatDateTime(value) {
    const pad = (number) => String(number).padStart(2, '0');
    return [
        value.getFullYear(),
        pad(value.getMonth() + 1),
        pad(value.getDate()),
    ].join('-') + ' ' + [
        pad(value.getHours()),
        pad(value.getMinutes()),
        pad(value.getSeconds()),
    ].join(':');
}

/**
 * HTML 이스케이핑
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * 정규표현식 문자 이스케이핑
 */
function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Explorer 파일명에서 검색 쿼리 하이라이팅
 */
function highlightExplorerName(text, query) {
    const source = String(text ?? '');
    const q = String(query ?? '').trim();
    if (!q) {
        return escapeHtml(source);
    }

    const pattern = new RegExp(escapeRegExp(q), 'ig');
    let lastIndex = 0;
    let html = '';

    source.replace(pattern, (match, offset) => {
        html += escapeHtml(source.slice(lastIndex, offset));
        html += `<mark class="explorer-match">${escapeHtml(match)}</mark>`;
        lastIndex = offset + match.length;
        return match;
    });

    html += escapeHtml(source.slice(lastIndex));
    return html;
}
