// @ts-nocheck
/**
 * app.pagination.js - Grid Virtualization & Pagination
 * 대용량 데이터셋 성능 최적화 (가상화 + 페이지네이션)
 */

class GridPagination {
    /**
     * @param {number} pageSize - 페이지당 행 수 (기본 100)
     * @param {number} bufferSize - 버퍼 크기 (가상화용, 기본 5 페이지)
     */
    constructor(pageSize = 100, bufferSize = 5) {
        this.pageSize = pageSize;
        this.bufferSize = bufferSize;
        this.currentPage = 0;
        this.totalRows = 0;
        this.totalPages = 0;
        this.isLoading = false;
        this.cache = new Map(); // page -> {columns, rows}
        this.scrollElement = null;
        this.onPageLoad = null;
    }

    /**
     * 초기 설정
     * @param {number} totalRows - 총 행 수
     * @param {HTMLElement} scrollElement - 스크롤 컨테이너
     * @param {function} onPageLoad - 페이지 로드 콜백
     */
    init(totalRows, scrollElement, onPageLoad) {
        this.totalRows = totalRows;
        this.totalPages = Math.ceil(totalRows / this.pageSize);
        this.scrollElement = scrollElement;
        this.onPageLoad = onPageLoad;
        this.currentPage = 0;
        this.cache.clear();

        if (this.scrollElement) {
            this.scrollElement.addEventListener('scroll', this.onScroll.bind(this));
        }

        outputLog(`PAGINATION INIT totalRows=${totalRows} pageSize=${this.pageSize} totalPages=${this.totalPages}`);
    }

    /**
     * 페이지 데이터 생성 (LIMIT/OFFSET)
     * @param {string} baseQuery - 기본 쿼리 (예: "SELECT * FROM users")
     * @param {number} pageNum - 페이지 번호 (0-indexed)
     * @returns {string} LIMIT/OFFSET가 추가된 쿼리
     */
    getPageQuery(baseQuery, pageNum = 0) {
        const offset = pageNum * this.pageSize;
        const limit = this.pageSize;
        
        // WHERE, GROUP BY, ORDER BY 후에 추가
        const query = baseQuery.replace(/;$/, '');
        return `${query} LIMIT ${limit} OFFSET ${offset}`;
    }

    /**
     * 페이지 캐시에 저장
     * @param {number} pageNum - 페이지 번호
     * @param {Array} columns - 컬럼명
     * @param {Array} rows - 데이터 행
     */
    setPage(pageNum, columns, rows) {
        this.cache.set(pageNum, { columns, rows, timestamp: Date.now() });
        outputLog(`PAGINATION CACHE SET page=${pageNum} rows=${rows.length}`);
    }

    /**
     * 캐시에서 페이지 조회
     * @param {number} pageNum - 페이지 번호
     * @returns {object|null} { columns, rows } 또는 null
     */
    getPage(pageNum) {
        return this.cache.get(pageNum) || null;
    }

    /**
     * 버퍼 범위 내 페이지 목록 (현재 페이지 ±bufferSize)
     * @returns {number[]} 로드해야 할 페이지 번호 배열
     */
    getBufferedPages() {
        const pages = [];
        const start = Math.max(0, this.currentPage - this.bufferSize);
        const end = Math.min(this.totalPages - 1, this.currentPage + this.bufferSize);
        for (let i = start; i <= end; i++) {
            if (!this.cache.has(i)) {
                pages.push(i);
            }
        }
        return pages;
    }

    /**
     * 스크롤 이벤트 핸들러
     */
    onScroll() {
        if (!this.scrollElement) return;

        const { scrollTop, scrollHeight, clientHeight } = this.scrollElement;
        const scrollPercent = (scrollTop + clientHeight) / scrollHeight;

        // 스크롤 위치에서 현재 페이지 계산
        const visibleRowsStart = Math.floor(scrollTop / 30); // 행 높이 ~30px
        const newPage = Math.floor(visibleRowsStart / this.pageSize);

        if (newPage !== this.currentPage) {
            this.currentPage = newPage;
            outputLog(`PAGINATION SCROLL page=${this.currentPage} scrollPercent=${(scrollPercent * 100).toFixed(1)}%`);
            this.loadBufferedPages();
        }

        // 하단 10% 도달 시 자동 로드
        if (scrollPercent > 0.9 && !this.isLoading) {
            const nextPage = this.currentPage + 1;
            if (nextPage < this.totalPages) {
                outputLog(`PAGINATION AUTO-LOAD next=${nextPage}`);
                this.loadPage(nextPage);
            }
        }
    }

    /**
     * 버퍼 범위 내 모든 페이지 로드
     */
    async loadBufferedPages() {
        const pages = this.getBufferedPages();
        if (pages.length === 0) return;

        outputLog(`PAGINATION BUFFER LOAD pages=${pages.join(',')} buffer=${this.bufferSize}`);
        
        for (const pageNum of pages) {
            if (!this.isLoading) {
                await this.loadPage(pageNum);
            }
        }
    }

    /**
     * 단일 페이지 로드
     * @param {number} pageNum - 페이지 번호
     */
    async loadPage(pageNum) {
        if (this.cache.has(pageNum) || this.isLoading) return;
        
        this.isLoading = true;
        try {
            if (this.onPageLoad) {
                await this.onPageLoad(pageNum);
            }
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 캐시 통계
     */
    getStats() {
        return {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            totalRows: this.totalRows,
            pageSize: this.pageSize,
            cacheSize: this.cache.size,
            cacheEntries: Array.from(this.cache.keys()).sort((a, b) => a - b),
        };
    }

    /**
     * 캐시 초기화
     */
    clear() {
        this.cache.clear();
        this.currentPage = 0;
        outputLog('PAGINATION CACHE CLEARED');
    }
}

// 전역 페이지네이션 인스턴스
const gridPagination = new GridPagination(100, 5);
