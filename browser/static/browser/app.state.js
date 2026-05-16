/**
 * app.state.js - State Management
 * 애플리케이션의 전역 상태와 DOM 요소 캐싱
 */

// 애플리케이션 전역 상태
const state = {
    currentPath: '',
    currentDatabase: null,
    activeTab: null,
    loadedTables: new Map(),
    tableTabIds: new Map(),
    explorerFilter: '',
    lastTreeData: null,
    // Grid state
    activeCell: null, // { row, col }
    selectedCells: new Set(), // "row,col" format
    selectionStart: null, // { row, col }
    selectionEnd: null, // { row, col }
    gridDragging: false,
    gridLastClickedCell: null,
};

// DOM 요소 캐싱
const domElements = {
    // Explorer
    explorerList: document.getElementById('explorer-list'),
    explorerStatusbar: document.getElementById('explorer-statusbar'),
    explorerFilter: document.getElementById('explorer-filter'),

    // Panel
    panelStack: document.querySelector('.panel-stack'),
    currentPath: document.getElementById('workspace-root'),
    tabs: document.getElementById('tabs'),
    workspaceFrame: document.querySelector('.workspace-frame'),
    welcomeTab: document.getElementById('welcome-tab'),

    // Chat
    chatResponse: document.getElementById('chat-response'),

    // File/Workspace
    workspaceFile: document.getElementById('workspace-file'),
    workspaceReload: document.getElementById('workspace-reload'),

    // Output
    outputBody: document.getElementById('output-body'),

    // Rail buttons
    railButtons: Array.from(document.querySelectorAll('.rail-button')),
};

// 상태 관련 변수들
let selectedExplorerPath = '';
const gridRenderState = new WeakMap();
let gridContextMenu = null;
