/**
 * app.query.controller.js - Query UI wiring
 */

function initQueryPane() {
    const layout = document.getElementById('query-layout');
    const splitter = document.getElementById('query-splitter');
    const editorPane = document.getElementById('query-pane-editor');
    const textarea = document.getElementById('sql-editor');
    const highlight = document.getElementById('sql-highlight');

    if (textarea instanceof HTMLTextAreaElement && highlight) {
        const sync = () => renderSqlHighlight(textarea, highlight);
        textarea.addEventListener('input', sync);
        textarea.addEventListener('scroll', sync);
        sync();
    }

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
