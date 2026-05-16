/**
 * app.api.js - API Request Wrapper
 * 서버와의 HTTP 통신 관련 함수
 */

/**
 * JSON 응답을 반환하는 HTTP 요청
 */
async function requestJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
    }
    return data;
}
