/**
 * app.tabs.js - Tab Management
 * 탭 생성/활성화 및 Query Split 관리
 */

function ensureTab(id, title, contentHtml) {
    let tabButton = document.querySelector(`[data-tab="${id}"]`);
    let tabContent = document.getElementById(`tab-${id}`);

    if (!tabButton) {
        tabButton = document.createElement('button');
        tabButton.className = 'tab-button';
        /** @type {HTMLElement} */ (tabButton).dataset.tab = id;
        tabButton.textContent = title;
        tabButton.addEventListener('click', () => activateTab(id));
        domElements.tabs.appendChild(tabButton);
    }

    if (!tabContent) {
        tabContent = document.createElement('section');
        tabContent.id = `tab-${id}`;
        tabContent.className = 'tab-content';
        domElements.workspaceFrame.appendChild(tabContent);
    }

    if (contentHtml !== undefined) {
        tabContent.innerHTML = contentHtml;
    }
}

function activateTab(id) {
    state.activeTab = id;
    domElements.welcomeTab.classList.remove('active');

    document.querySelectorAll('.tab-button').forEach((button) => {
        const tab = /** @type {HTMLElement} */ (button);
        tab.classList.toggle('active', tab.dataset.tab === id);
    });
    document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `tab-${id}`);
    });
}

function initQuerySplit() {
    const layout = document.getElementById('query-layout');
    const splitter = document.getElementById('query-splitter');
    const editorPane = document.getElementById('query-pane-editor');
    if (!layout || !splitter || !editorPane) {
        return;
    }

    let dragging = false;
    let startY = 0;
    let startHeight = 0;
    const splitterHeight = 8;
    const minTop = 74;
    const minBottom = 84;

    const applyTopPx = (nextTop) => {
        layout.style.gridTemplateRows = `${nextTop}px ${splitterHeight}px minmax(${minBottom}px, 1fr)`;
    };

    const onPointerMove = (event) => {
        if (!dragging) {
            return;
        }

        const rect = layout.getBoundingClientRect();
        const deltaY = event.clientY - startY;
        let nextTop = startHeight + deltaY;
        const maxTop = rect.height - splitterHeight - minBottom;
        if (nextTop < minTop) {
            nextTop = minTop;
        }
        if (nextTop > maxTop) {
            nextTop = maxTop;
        }
        applyTopPx(nextTop);
    };

    const stopDragging = () => {
        if (!dragging) {
            return;
        }
        dragging = false;
        splitter.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    splitter.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        dragging = true;
        startY = event.clientY;
        startHeight = editorPane.getBoundingClientRect().height;
        splitter.classList.add('is-dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        splitter.setPointerCapture(event.pointerId);
    });

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    splitter.addEventListener('dblclick', () => {
        layout.style.gridTemplateRows = '';
    });
}
