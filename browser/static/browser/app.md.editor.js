// @ts-nocheck
/**
 * app.md.editor.js - Markdown File Editor with Tabs
 * MD 파일 탭 기반 편집기
 */

/** @type {{ path: string, title: string, content: string, originalContent: string }[]} */
const _mdTabs = [];
let _mdActiveTabPath = null;

function _getMdPanelEl() { return document.getElementById('md-editor-panel'); }
function _getMdTabBarEl() { return document.getElementById('md-tab-bar'); }
function _getMdTextareaEl() { return /** @type {HTMLTextAreaElement | null} */ (document.getElementById('md-editor-textarea')); }
function _getMdTitleEl() { return document.getElementById('md-editor-title'); }

/**
 * MD 탭이 열려 있는지 확인
 * @returns {boolean}
 */
function hasMdTabsOpen() {
    return _mdTabs.length > 0;
}

/**
 * 저장 안된 MD 탭이 있는지 확인
 * @returns {boolean}
 */
function hasDirtyMdTabs() {
    return _mdTabs.some((t) => t.content !== t.originalContent);
}

/**
 * MD 파일 열기 (이미 열려 있으면 해당 탭 활성화)
 * @param {string} path
 */
async function openMdEditor(path) {
    const existing = _mdTabs.find((t) => t.path === path);
    if (existing) {
        _activateMdTab(path);
        return;
    }

    try {
        outputLog(`MD READ ${path}`);
        const data = /** @type {any} */ (await requestJson(`/api/file/read/?path=${encodeURIComponent(path)}`));
        const content = String(data.content || '');
        const title = path.split('/').pop() || path;

        _mdTabs.push({ path, title, content, originalContent: content });
        _renderMdTabBar();
        _activateMdTab(path);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputLog(`MD READ ERROR ${msg}`, 'error');
    }
}

/**
 * 특정 탭 활성화
 * @param {string} path
 */
function _activateMdTab(path) {
    _mdActiveTabPath = path;
    _renderMdTabBar();
    _renderMdEditorContent();
    _showMdEditorPanel();
}

/**
 * MD 에디터 패널 표시 (DB 뷰 숨기기)
 */
function _showMdEditorPanel() {
    const panel = _getMdPanelEl();
    if (!panel) { return; }
    panel.style.display = 'flex';

    // DB 탭바 + workspace-frame 숨기기
    if (domElements.tabs) { domElements.tabs.style.display = 'none'; }
    if (domElements.workspaceFrame) { domElements.workspaceFrame.style.display = 'none'; }
    if (domElements.welcomeTab) { domElements.welcomeTab.classList.remove('active'); }
}

/**
 * MD 에디터 패널 숨기기 (DB 뷰 복원)
 */
function _hideMdEditorPanel() {
    const panel = _getMdPanelEl();
    if (panel) { panel.style.display = 'none'; }

    if (domElements.tabs) { domElements.tabs.style.display = ''; }
    if (domElements.workspaceFrame) { domElements.workspaceFrame.style.display = ''; }
}

/**
 * 탭 바 다시 렌더링
 */
function _renderMdTabBar() {
    const tabBar = _getMdTabBarEl();
    if (!tabBar) { return; }

    tabBar.innerHTML = _mdTabs.map((tab) => {
        const isActive = tab.path === _mdActiveTabPath;
        const isDirty = tab.content !== tab.originalContent;
        return `
            <button class="tab-button md-tab-btn${isActive ? ' active' : ''}" data-md-path="${escapeHtml(tab.path)}" title="${escapeHtml(tab.path)}">
                <span class="md-tab-title">${escapeHtml(tab.title)}${isDirty ? '<span class="md-dirty-dot"> ●</span>' : ''}</span>
                <span class="md-tab-close" data-md-close="${escapeHtml(tab.path)}" title="닫기" aria-label="닫기">×</span>
            </button>
        `;
    }).join('');
}

/**
 * 활성 탭 내용을 에디터에 렌더링
 */
function _renderMdEditorContent() {
    const tab = _mdTabs.find((t) => t.path === _mdActiveTabPath);
    if (!tab) { return; }

    const textarea = _getMdTextareaEl();
    if (textarea) {
        textarea.value = tab.content;
        textarea.setSelectionRange(0, 0);
        textarea.scrollTop = 0;
    }

    const titleEl = _getMdTitleEl();
    if (titleEl) {
        titleEl.textContent = tab.path;
    }
}

/**
 * 특정 탭 저장
 * @param {string} path
 */
async function saveMdTab(path) {
    const tab = _mdTabs.find((t) => t.path === path);
    if (!tab) { return; }

    try {
        outputLog(`MD SAVE ${path}`);
        await requestJson('/api/file/write/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tab.path, content: tab.content }),
        });
        tab.originalContent = tab.content;
        _renderMdTabBar();
        outputLog(`MD SAVED ${path}`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputLog(`MD SAVE ERROR ${msg}`, 'error');
    }
}

/**
 * 특정 탭 닫기
 * @param {string} path
 * @param {boolean} [force=false] dirty 확인 생략
 * @returns {boolean} 실제로 닫혔으면 true
 */
function closeMdTab(path, force = false) {
    const tab = _mdTabs.find((t) => t.path === path);
    if (!tab) { return true; }

    if (!force && tab.content !== tab.originalContent) {
        // eslint-disable-next-line no-alert
        if (!confirm(`'${tab.title}'에 저장되지 않은 변경사항이 있습니다.\n저장하지 않고 닫으시겠습니까?`)) {
            return false;
        }
    }

    const idx = _mdTabs.findIndex((t) => t.path === path);
    _mdTabs.splice(idx, 1);

    if (_mdActiveTabPath === path) {
        if (_mdTabs.length > 0) {
            // 가능하면 이전 탭, 없으면 마지막 탭으로
            const nextTab = _mdTabs[Math.min(idx, _mdTabs.length - 1)];
            _mdActiveTabPath = nextTab.path;
            _renderMdTabBar();
            _renderMdEditorContent();
        } else {
            _mdActiveTabPath = null;
            _hideMdEditorPanel();
        }
    } else {
        _renderMdTabBar();
    }

    return true;
}

/**
 * 모든 MD 탭 닫기 (폴더 이동 시 호출)
 * @param {boolean} [force=false] dirty 확인 생략
 * @returns {boolean} 이동 허용 여부 (false면 사용자가 취소)
 */
function closeAllMdTabs(force = false) {
    if (!force && hasDirtyMdTabs()) {
        const dirtyTitles = _mdTabs
            .filter((t) => t.content !== t.originalContent)
            .map((t) => t.title)
            .join(', ');
        // eslint-disable-next-line no-alert
        if (!confirm(`저장되지 않은 파일이 있습니다: ${dirtyTitles}\n저장하지 않고 이동하시겠습니까?`)) {
            return false;
        }
    }

    _mdTabs.length = 0;
    _mdActiveTabPath = null;
    _hideMdEditorPanel();

    const tabBar = _getMdTabBarEl();
    if (tabBar) { tabBar.innerHTML = ''; }

    return true;
}

/**
 * MD 에디터 이벤트 연결 (앱 초기화 시 1회 호출)
 */
function wireMdEditor() {
    // 탭 바 클릭 이벤트 (이벤트 위임)
    const tabBar = _getMdTabBarEl();
    if (tabBar) {
        tabBar.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) { return; }

            const closeBtn = target.closest('[data-md-close]');
            if (closeBtn instanceof HTMLElement && closeBtn.dataset.mdClose) {
                closeMdTab(closeBtn.dataset.mdClose);
                return;
            }

            const tabBtn = target.closest('.md-tab-btn');
            if (tabBtn instanceof HTMLElement && tabBtn.dataset.mdPath) {
                _activateMdTab(tabBtn.dataset.mdPath);
            }
        });
    }

    // 텍스트 변경 감지
    const textarea = _getMdTextareaEl();
    if (textarea) {
        textarea.addEventListener('input', () => {
            const tab = _mdTabs.find((t) => t.path === _mdActiveTabPath);
            if (tab) {
                tab.content = textarea.value;
                _renderMdTabBar();
            }
        });

        // Ctrl+S 저장
        textarea.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (_mdActiveTabPath) {
                    saveMdTab(_mdActiveTabPath);
                }
            }
        });
    }

    // 저장 버튼
    const saveBtn = document.getElementById('md-editor-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (_mdActiveTabPath) {
                saveMdTab(_mdActiveTabPath);
            }
        });
    }
}
