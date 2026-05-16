/**
 * app.sql.js - SQL Handling
 * SQL 하이라이팅 및 처리 관련 함수
 */

const SQL_KEYWORD_PATTERN = /\b(select|from|where|group|order|by|limit|join|left|right|inner|outer|on|as|and|or|not|null|is|in|exists|like|between|having|union|all|distinct|insert|into|values|update|set|delete|create|table|view|index|drop|alter|pragma|with|case|when|then|else|end|count|sum|min|max|avg)\b/gi;

/**
 * SQL 텍스트에 키워드 하이라이팅 적용
 */
function renderSqlHighlight(textarea, highlight) {
    const source = textarea.value || '';
    const escaped = escapeHtml(source);
    const colored = escaped.replace(SQL_KEYWORD_PATTERN, '<span class="sql-kw">$1</span>');
    highlight.innerHTML = `${colored}\n`;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
}

/**
 * SQL 에디터 하이라이팅 초기화
 */
function initSqlHighlight() {
    const textarea = document.getElementById('sql-editor');
    const highlight = document.getElementById('sql-highlight');
    if (!textarea || !highlight) {
        return;
    }

    const sync = () => renderSqlHighlight(textarea, highlight);
    textarea.addEventListener('input', sync);
    textarea.addEventListener('scroll', sync);
    sync();
}
