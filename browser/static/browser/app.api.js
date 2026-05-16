/**
 * app.api.js - API Request Wrapper
 * 서버와의 HTTP 통신 관련 함수
 */

/**
 * @typedef {Record<string, unknown>} JsonObject
 */

/**
 * 서버 JSON 응답이 객체 형태인지 검증한다.
 * @param {unknown} value
 * @returns {JsonObject}
 */
function asJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return /** @type {JsonObject} */ (value);
    }
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
}

/**
 * JSON 응답을 반환하는 HTTP 요청
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<JsonObject>}
 */
async function requestJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const parsed = await response.json().catch(() => ({}));
    const data = asJsonObject(parsed);
    if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : '요청 처리 중 오류가 발생했습니다.';
        throw new Error(message);
    }
    return data;
}
