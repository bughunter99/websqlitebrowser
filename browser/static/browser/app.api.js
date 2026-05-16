/**
 * app.api.js - API Request Wrapper with Error Handling
 * 서버와의 HTTP 통신 관련 함수 (타임아웃, 재시도 포함)
 */

/**
 * @typedef {Record<string, unknown>} JsonObject
 */

/**
 * API 요청 설정
 */
const API_CONFIG = {
    timeout: 10000,           // 기본 타임아웃 (10초)
    maxRetries: 3,            // 최대 재시도 횟수
    retryDelay: 1000,         // 첫 재시도 대기 시간 (ms)
    retryableStatuses: [408, 429, 500, 502, 503, 504], // 재시도 가능한 상태 코드
};

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
 * JSON 응답을 반환하는 HTTP 요청 (타임아웃, 재시도 지원)
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [retryCount=0]
 * @returns {Promise<JsonObject>}
 */
async function requestJson(url, options = {}, retryCount = 0) {
    const controller = new AbortController();
    const startTime = Date.now();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);
    
    try {
        const response = await fetch(url, {
            cache: 'no-store',
            ...options,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        
        let parsed;
        try {
            parsed = await response.json();
        } catch {
            performanceMetrics.recordRequest(url, duration, 0, retryCount);
            throw new Error('서버 응답 형식이 올바르지 않습니다.');
        }

        const data = asJsonObject(parsed);
        if (!response.ok) {
            // 재시도 가능한 상태 코드인 경우
            if (API_CONFIG.retryableStatuses.includes(response.status) && retryCount < API_CONFIG.maxRetries) {
                performanceMetrics.recordRequest(url, duration, response.status, retryCount);
                const delay = API_CONFIG.retryDelay * Math.pow(2, retryCount);
                outputLog(`API RETRY url=${url.slice(0, 60)} status=${response.status} attempt=${retryCount + 1}/${API_CONFIG.maxRetries} delay=${delay}ms`, 'warn');
                await new Promise(resolve => setTimeout(resolve, delay));
                return requestJson(url, options, retryCount + 1);
            }

            performanceMetrics.recordRequest(url, duration, response.status, retryCount);
            const message = typeof data.error === 'string' ? data.error : '요청 처리 중 오류가 발생했습니다.';
            const error = new Error(message);
            error.statusCode = response.status;
            throw error;
        }
        
        // 성공 기록
        performanceMetrics.recordRequest(url, duration, response.status, retryCount);
        return data;
    } catch (error) {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        
        // 타임아웃 에러
        if (error instanceof DOMException && error.name === 'AbortError') {
            performanceMetrics.recordRequest(url, duration, 0, retryCount);
            if (retryCount < API_CONFIG.maxRetries) {
                const delay = API_CONFIG.retryDelay * Math.pow(2, retryCount);
                outputLog(`API TIMEOUT RETRY url=${url.slice(0, 60)} attempt=${retryCount + 1}/${API_CONFIG.maxRetries} delay=${delay}ms`, 'warn');
                await new Promise(resolve => setTimeout(resolve, delay));
                return requestJson(url, options, retryCount + 1);
            }
            const timeoutError = new Error('서버 응답 시간이 초과되었습니다.');
            timeoutError.code = 'TIMEOUT';
            throw timeoutError;
        }

        // 네트워크 에러
        if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            performanceMetrics.recordRequest(url, duration, 0, retryCount);
            if (retryCount < API_CONFIG.maxRetries) {
                const delay = API_CONFIG.retryDelay * Math.pow(2, retryCount);
                outputLog(`API NETWORK RETRY url=${url.slice(0, 60)} attempt=${retryCount + 1}/${API_CONFIG.maxRetries} delay=${delay}ms`, 'warn');
                await new Promise(resolve => setTimeout(resolve, delay));
                return requestJson(url, options, retryCount + 1);
            }
            const networkError = new Error('네트워크 연결을 확인하세요.');
            networkError.code = 'NETWORK_ERROR';
            throw networkError;
        }

        throw error;
    }
}
