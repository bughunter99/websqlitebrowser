/**
 * app.cache.js - Query Result Caching
 * 쿼리 결과를 TTL 기반으로 캐싱하여 성능 최적화
 */

/**
 * 쿼리 결과 캐시 매니저
 * - LRU (Least Recently Used) 전략
 * - TTL (Time To Live) 기반 자동 만료
 * - 최대 50개 항목 저장
 */
class QueryResultCache {
    constructor(maxSize = 50, defaultTtlMs = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.defaultTtlMs = defaultTtlMs;
        this.cache = new Map();
        this.timestamps = new Map();
        this.accessTimes = new Map();
    }

    /**
     * SQL 문과 파라미터로부터 캐시 키 생성
     * @param {string} sql SQL 쿼리
     * @param {string} dbPath 데이터베이스 경로
     * @returns {string} 캐시 키
     */
    generateKey(sql, dbPath) {
        // 정규화: 공백 제거, 대문자 변환
        const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();
        return `${dbPath}||${normalized}`;
    }

    /**
     * 캐시에서 결과 조회
     * @param {string} sql SQL 쿼리
     * @param {string} dbPath 데이터베이스 경로
     * @returns {Object|null} 캐시된 결과 또는 null
     */
    get(sql, dbPath) {
        const key = this.generateKey(sql, dbPath);
        
        // TTL 확인
        if (this.timestamps.has(key)) {
            const now = Date.now();
            const ttl = this.timestamps.get(key);
            if (now > ttl) {
                // 만료된 항목 삭제
                this.cache.delete(key);
                this.timestamps.delete(key);
                this.accessTimes.delete(key);
                console.log(`[CACHE] Expired: ${key.substring(0, 50)}...`);
                return null;
            }
        }

        // 접근 시간 업데이트 (LRU)
        if (this.cache.has(key)) {
            this.accessTimes.set(key, Date.now());
            const result = this.cache.get(key);
            console.log(`[CACHE] HIT: ${key.substring(0, 50)}...`);
            return JSON.parse(JSON.stringify(result)); // Deep copy
        }

        return null;
    }

    /**
     * 캐시에 결과 저장
     * @param {string} sql SQL 쿼리
     * @param {string} dbPath 데이터베이스 경로
     * @param {Object} result 쿼리 결과
     * @param {number} ttlMs TTL (밀리초)
     */
    set(sql, dbPath, result, ttlMs = this.defaultTtlMs) {
        const key = this.generateKey(sql, dbPath);
        
        // 캐시 크기 제한 (LRU: 가장 오래 접근하지 않은 항목 제거)
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const lruKey = Array.from(this.accessTimes.entries())
                .sort((a, b) => a[1] - b[1])[0][0];
            this.cache.delete(lruKey);
            this.timestamps.delete(lruKey);
            this.accessTimes.delete(lruKey);
            console.log(`[CACHE] Evicted LRU: ${lruKey.substring(0, 50)}...`);
        }

        this.cache.set(key, result);
        this.timestamps.set(key, Date.now() + ttlMs);
        this.accessTimes.set(key, Date.now());
        console.log(`[CACHE] SET: ${key.substring(0, 50)}... (ttl: ${ttlMs}ms)`);
    }

    /**
     * 특정 데이터베이스의 모든 캐시 초기화
     * @param {string} dbPath 데이터베이스 경로
     */
    clearByDatabase(dbPath) {
        const keysToDelete = Array.from(this.cache.keys())
            .filter(key => key.startsWith(dbPath + '||'));
        
        keysToDelete.forEach(key => {
            this.cache.delete(key);
            this.timestamps.delete(key);
            this.accessTimes.delete(key);
        });

        console.log(`[CACHE] Cleared ${keysToDelete.length} entries for ${dbPath}`);
    }

    /**
     * 전체 캐시 초기화
     */
    clear() {
        const count = this.cache.size;
        this.cache.clear();
        this.timestamps.clear();
        this.accessTimes.clear();
        console.log(`[CACHE] Cleared all (${count} entries)`);
    }

    /**
     * 캐시 통계 출력
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: this.hitRate || 0,
        };
    }

    /**
     * 테이블 이름으로 관련 캐시 무효화
     * @param {string} dbPath 데이터베이스 경로
     * @param {string} tableName 테이블 이름
     */
    invalidateByTableName(dbPath, tableName) {
        const keysToDelete = Array.from(this.cache.keys())
            .filter(key => {
                if (!key.startsWith(dbPath + '||')) return false;
                const sql = key.substring((dbPath + '||').length);
                // 테이블 이름을 포함한 쿼리 찾기
                const tableRegex = new RegExp(`\\bFROM\\s+${tableName}\\b|\\bINTO\\s+${tableName}\\b|\\bUPDATE\\s+${tableName}\\b|\\bDELETE\\s+FROM\\s+${tableName}\\b`, 'i');
                return tableRegex.test(sql);
            });

        keysToDelete.forEach(key => {
            this.cache.delete(key);
            this.timestamps.delete(key);
            this.accessTimes.delete(key);
        });

        if (keysToDelete.length > 0) {
            outputLog(`CACHE INVALIDATE table=${tableName} removed=${keysToDelete.length} entries`, 'info');
        }
    }

    /**
     * 쓰기 쿼리인 경우 DB의 모든 캐시 초기화
     * @param {string} sql SQL 쿼리
     * @param {string} dbPath 데이터베이스 경로
     */
    clearIfWriteQuery(sql, dbPath) {
        const trimmed = sql.trim().toUpperCase();
        const isWriteQuery = /^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|TRUNCATE|PRAGMA)/i.test(trimmed);

        if (isWriteQuery) {
            this.clearByDatabase(dbPath);
            outputLog(`CACHE CLEARED write_query=${sql.substring(0, 50)}...`, 'warn');
        }
    }
}

// 전역 캐시 인스턴스
const queryResultCache = new QueryResultCache(50, 5 * 60 * 1000); // 5분 TTL
