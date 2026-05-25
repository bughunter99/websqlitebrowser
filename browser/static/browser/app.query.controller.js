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

        const getSelectedLineRange = () => {
            const value = textarea.value || '';
            const start = Number(textarea.selectionStart || 0);
            const end = Number(textarea.selectionEnd || 0);
            const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
            let lineEnd = value.indexOf('\n', end);
            if (lineEnd === -1) {
                lineEnd = value.length;
            }
            return {
                value,
                start,
                end,
                lineStart,
                lineEnd,
                selectedText: value.slice(lineStart, lineEnd),
            };
        };

        const outdentLine = (line) => {
            if (line.startsWith('\t')) {
                return { text: line.slice(1), removed: 1 };
            }
            const spaceMatch = line.match(/^ {1,4}/);
            if (spaceMatch) {
                const removeCount = spaceMatch[0].length;
                return { text: line.slice(removeCount), removed: removeCount };
            }
            return { text: line, removed: 0 };
        };

        textarea.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') {
                return;
            }

            event.preventDefault();
            const { value, start, end, lineStart, lineEnd, selectedText } = getSelectedLineRange();
            const hasSelection = end > start;

            if (event.shiftKey) {
                const lines = selectedText.split('\n');
                let removedOnFirstLine = 0;
                let totalRemoved = 0;
                const outdentedLines = lines.map((line, index) => {
                    const outdented = outdentLine(line);
                    if (index === 0) {
                        removedOnFirstLine = outdented.removed;
                    }
                    totalRemoved += outdented.removed;
                    return outdented.text;
                });

                const replacement = outdentedLines.join('\n');
                textarea.value = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;

                if (hasSelection) {
                    const nextStart = Math.max(lineStart, start - removedOnFirstLine);
                    const nextEnd = Math.max(nextStart, end - totalRemoved);
                    textarea.setSelectionRange(nextStart, nextEnd);
                } else {
                    const nextCaret = Math.max(lineStart, start - removedOnFirstLine);
                    textarea.setSelectionRange(nextCaret, nextCaret);
                }
            } else if (hasSelection) {
                const lines = selectedText.split('\n');
                const indentedLines = lines.map((line) => `\t${line}`);
                const replacement = indentedLines.join('\n');
                textarea.value = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;

                const insertedCount = lines.length;
                const nextStart = start + 1;
                const nextEnd = end + insertedCount;
                textarea.setSelectionRange(nextStart, nextEnd);
            } else {
                textarea.value = `${value.slice(0, start)}\t${value.slice(end)}`;
                const nextCaret = start + 1;
                textarea.setSelectionRange(nextCaret, nextCaret);
            }

            sync();
        });
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
