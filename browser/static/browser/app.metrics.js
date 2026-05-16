// @ts-nocheck
/**
 * app.metrics.js - Performance Monitoring & Metrics Collection
 * API 요청, 캐시 성능, 쿼리 성능 등을 추적합니다.
 */

class PerformanceMetrics {
    constructor() {
        this.requests = [];        // API 요청 기록
        this.queries = [];         // 쿼리 실행 기록
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            invalidations: 0,
        };
        this.maxRecords = 500;     // 최대 기록 수
        this.enabled = true;
    }

    /**
     * API 요청 기록
     * @param {string} url API 엔드포인트
     * @param {number} duration 소요 시간 (ms)
     * @param {number} statusCode HTTP 상태 코드
     * @param {number} retries 재시도 횟수
     */
    recordRequest(url, duration, statusCode, retries = 0) {
        if (!this.enabled) return;

        this.requests.push({
            timestamp: Date.now(),
            url: url.slice(0, 100),
            duration,
            statusCode,
            retries,
            type: statusCode >= 400 ? 'error' : statusCode >= 300 ? 'redirect' : 'success',
        });

        // 최대 기록 수 유지
        if (this.requests.length > this.maxRecords) {
            this.requests.shift();
        }
    }

    /**
     * 쿼리 실행 기록
     * @param {string} sql SQL 쿼리
     * @param {number} duration 소요 시간 (ms)
     * @param {number} rowCount 반환 행 수
     * @param {boolean} cached 캐시 히트 여부
     * @param {boolean} success 성공 여부
     */
    recordQuery(sql, duration, rowCount, cached = false, success = true) {
        if (!this.enabled) return;

        const queryType = /^SELECT/i.test(sql) ? 'select' : 'write';

        this.queries.push({
            timestamp: Date.now(),
            sql: sql.substring(0, 100),
            duration,
            rowCount,
            cached,
            success,
            queryType,
        });

        // 캐시 통계 업데이트
        if (cached) {
            this.cacheStats.hits++;
        } else {
            this.cacheStats.misses++;
        }

        // 최대 기록 수 유지
        if (this.queries.length > this.maxRecords) {
            this.queries.shift();
        }
    }

    /**
     * 캐시 무효화 기록
     * @param {string} reason 무효화 사유 ('eviction', 'ttl', 'write', 'manual')
     */
    recordCacheEvent(reason) {
        if (!this.enabled) return;
        this.cacheStats.invalidations++;
        outputLog(`METRICS CACHE_EVENT reason=${reason}`, 'info');
    }

    /**
     * API 요청 성능 요약
     */
    getRequestStats() {
        if (this.requests.length === 0) {
            return { total: 0, avgDuration: 0, errorRate: 0 };
        }

        const total = this.requests.length;
        const avgDuration = this.requests.reduce((sum, r) => sum + r.duration, 0) / total;
        const errorCount = this.requests.filter(r => r.type === 'error').length;
        const errorRate = (errorCount / total * 100).toFixed(2);
        const maxDuration = Math.max(...this.requests.map(r => r.duration));
        const minDuration = Math.min(...this.requests.map(r => r.duration));

        return {
            total,
            avgDuration: Math.round(avgDuration),
            errorRate: parseFloat(errorRate),
            maxDuration,
            minDuration,
            errorCount,
        };
    }

    /**
     * 쿼리 성능 요약
     */
    getQueryStats() {
        if (this.queries.length === 0) {
            return { total: 0, avgDuration: 0, cachedCount: 0, cacheHitRate: 0 };
        }

        const total = this.queries.length;
        const cachedQueries = this.queries.filter(q => q.cached);
        const cachedCount = cachedQueries.length;
        const avgDuration = this.queries.reduce((sum, q) => sum + q.duration, 0) / total;
        const avgCachedDuration = cachedQueries.length > 0
            ? cachedQueries.reduce((sum, q) => sum + q.duration, 0) / cachedQueries.length
            : 0;
        const cacheHitRate = ((cachedCount / total) * 100).toFixed(2);

        return {
            total,
            avgDuration: Math.round(avgDuration),
            avgCachedDuration: Math.round(avgCachedDuration),
            cachedCount,
            cacheHitRate: parseFloat(cacheHitRate),
            totalRows: this.queries.reduce((sum, q) => sum + (q.rowCount || 0), 0),
        };
    }

    /**
     * 캐시 성능 통계
     */
    getCacheStats() {
        const total = this.cacheStats.hits + this.cacheStats.misses;
        const hitRate = total > 0 ? ((this.cacheStats.hits / total) * 100).toFixed(2) : 0;

        return {
            hits: this.cacheStats.hits,
            misses: this.cacheStats.misses,
            hitRate: parseFloat(hitRate),
            evictions: this.cacheStats.evictions,
            invalidations: this.cacheStats.invalidations,
        };
    }

    /**
     * 전체 성능 요약
     */
    getSummary() {
        return {
            timestamp: new Date().toISOString(),
            requests: this.getRequestStats(),
            queries: this.getQueryStats(),
            cache: this.getCacheStats(),
        };
    }

    /**
     * 최근 N개의 요청 기록 반환
     */
    getRecentRequests(limit = 10) {
        return this.requests.slice(-limit).reverse();
    }

    /**
     * 최근 N개의 쿼리 기록 반환
     */
    getRecentQueries(limit = 10) {
        return this.queries.slice(-limit).reverse();
    }

    /**
     * 느린 요청 조회 (duration > threshold)
     */
    getSlowRequests(thresholdMs = 1000) {
        return this.requests
            .filter(r => r.duration > thresholdMs)
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10);
    }

    /**
     * 느린 쿼리 조회
     */
    getSlowQueries(thresholdMs = 1000) {
        return this.queries
            .filter(q => q.duration > thresholdMs)
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10);
    }

    /**
     * 메트릭 초기화
     */
    clear() {
        this.requests = [];
        this.queries = [];
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            invalidations: 0,
        };
        outputLog('METRICS CLEARED all records', 'info');
    }

    /**
     * 메트릭 출력 (콘솔)
     */
    printSummary() {
        const summary = this.getSummary();
        outputLog(`
=== PERFORMANCE SUMMARY ===
Requests: ${summary.requests.total} (avg: ${summary.requests.avgDuration}ms, error: ${summary.requests.errorRate}%)
Queries: ${summary.queries.total} (avg: ${summary.queries.avgDuration}ms, cached: ${summary.queries.cacheHitRate}%)
Cache: hits=${summary.cache.hits}, misses=${summary.cache.misses}, hitRate=${summary.cache.hitRate}%
        `, 'info');
    }

    /**
     * 메트릭 토글
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        outputLog(`METRICS ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
    }
}

// 전역 메트릭 인스턴스
const performanceMetrics = new PerformanceMetrics();
