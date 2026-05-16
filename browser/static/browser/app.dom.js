/**
 * app.dom.js - DOM Cache
 * 자주 접근하는 DOM 요소를 한 곳에 모아 둔다.
 */

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