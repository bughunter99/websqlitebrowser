/**
 * app.shortcuts.js - Keyboard shortcuts
 */

function isEditableCopyContext(target) {
    const element = target instanceof Element ? target : document.activeElement;
    if (!element) {
        return false;
    }

    const editable = element.closest('textarea, input, [contenteditable="true"]');
    if (!editable) {
        return false;
    }

    if (editable.matches('textarea, input')) {
        const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (editable);
        const start = Number(input.selectionStart ?? 0);
        const end = Number(input.selectionEnd ?? 0);
        return end > start;
    }

    const selection = window.getSelection();
    return !!(selection && String(selection).length > 0);
}

function wireGlobalShortcuts() {
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
            if (isEditableCopyContext(event.target)) {
                return;
            }
            if (copySelectedGridCells()) {
                event.preventDefault();
                return;
            }
        }

        if (event.key === 'F9' && document.activeElement && document.activeElement.id === 'sql-editor') {
            event.preventDefault();
            if (!state.queryPending) {
                runQuery();
            }
        }
    });
}
