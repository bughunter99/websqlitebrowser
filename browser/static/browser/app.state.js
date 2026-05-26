/**
 * app.state.js - State Management
 * 애플리케이션의 전역 상태를 보관하는 저장소
 */

/**
 * 상태 변화를 추적하는 Observable 상태 생성
 * @param {Object} initialState 초기 상태 객체
 * @returns {Proxy} Observable state Proxy
 */
function createObservableState(initialState) {
    return new Proxy(initialState, {
        set: (target, property, value) => {
            const oldValue = target[property];
            
            // 값이 실제로 변경되었을 때만 로깅
            if (oldValue !== value) {
                // Map/Set 같은 특수 객체는 내용 비교가 필요하므로 로그하지 않음
                if (!(oldValue instanceof Map || oldValue instanceof Set || value instanceof Map || value instanceof Set)) {
                    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
                    // 긴 값은 축약
                    const displayOld = typeof oldValue === 'string' && oldValue.length > 50 ? oldValue.substring(0, 50) + '...' : oldValue;
                    const displayNew = typeof value === 'string' && value.length > 50 ? value.substring(0, 50) + '...' : value;
                    console.log(`[${timestamp}] STATE ${property}: ${displayOld} → ${displayNew}`);
                }
            }
            
            target[property] = value;
            return true;
        }
    });
}

// 애플리케이션 전역 상태
const state = createObservableState({
    currentPath: '',
    currentDatabase: null,
    activeTab: null,
    loadedTables: new Map(),
    tableTabIds: new Map(),
    tableLoadRequestSeq: 0,
    tableLoadRequestIds: new Map(),
    queryRequestSeq: 0,
    activeQueryRequestId: 0,
    queryPending: false,
    chatRequestSeq: 0,
    activeChatRequestId: 0,
    chatPending: false,
    chatInputHistory: [],
    chatInputHistoryIndex: -1,
    explorerFilter: '',
    lastTreeData: null,
    selectedExplorerPath: '',
    explorerCursor: '',
        explorerPaginationOffset: 0,
        explorerTotalEntries: 0,
        explorerHasMore: false,
    // Grid state
    activeCell: null, // { row, col }
    selectedCells: new Set(), // "row,col" format
    selectionStart: null, // { row, col }
    selectionEnd: null, // { row, col }
    gridDragging: false,
    gridLastClickedCell: null,
});

// 상태 관련 변수들
const gridRenderState = new WeakMap();
let gridContextMenu = null;
