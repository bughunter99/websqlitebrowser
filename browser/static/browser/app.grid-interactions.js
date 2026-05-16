/**
 * app.grid-interactions.js - Grid Interactions
 * 그리드 셀 선택, 키보드 네비게이션, 컨텍스트 메뉴 등
 */

/**
 * 그리드 상호작용 초기화
 */
function attachGridInteractions(container) {
    const grid = container.querySelector('.result-grid, .virtual-grid-wrap');
    if (!grid) {
        return;
    }

    initResultGridColumnResize(container);

    const getRowCol = (cell) => {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        return isNaN(row) || isNaN(col) ? null : { row, col };
    };


    // Mouse interactions
    grid.addEventListener('mousedown', (event) => {
        grid.focus();
        const cell = event.target.closest('td, .virtual-grid-td');
        if (!cell) {
            return;
        }

        const rc = getRowCol(cell);
        if (!rc) {
            return;
        }

        event.preventDefault();
        state.gridDragging = true;
        state.gridLastClickedCell = rc;

        if (event.shiftKey && state.activeCell) {
            gridSelectRange(grid, state.activeCell, rc);
        } else if (event.ctrlKey || event.metaKey) {
            const key = getGridCellKey(rc.row, rc.col);
            state.selectedCells.has(key) ? state.selectedCells.delete(key) : state.selectedCells.add(key);
            gridSetActiveCell(grid, container, rc.row, rc.col);
        } else {
            state.selectedCells.clear();
            state.selectedCells.add(getGridCellKey(rc.row, rc.col));
            gridSetActiveCell(grid, container, rc.row, rc.col);
        }
    });

    grid.addEventListener('mousemove', (event) => {
        if (!state.gridDragging || !state.gridLastClickedCell) {
            return;
        }

        const cell = event.target.closest('td, .virtual-grid-td');
        if (!cell) {
            return;
        }

        const rc = getRowCol(cell);
        if (!rc) {
            return;
        }

        gridSelectRange(grid, state.gridLastClickedCell, rc);
    });

    grid.addEventListener('contextmenu', (event) => {
        const cell = event.target.closest('td, .virtual-grid-td');
        if (!cell || cell.classList.contains('row-index-cell')) {
            return;
        }

        const rc = getRowCol(cell);
        if (!rc) {
            return;
        }

        event.preventDefault();
        hideGridContextMenu();

        const menu = document.createElement('div');
        menu.className = 'grid-context-menu';
        menu.innerHTML = [
            '<button type="button" data-action="copy-cell">Copy Cell</button>',
            '<button type="button" data-action="copy-selected">Copy Selected</button>',
            '<button type="button" data-action="select-row">Select Row</button>',
            '<button type="button" data-action="clear-selection">Clear Selection</button>',
        ].join('');

        const onAction = (action) => {
            if (action === 'copy-cell') {
                copyTextToClipboard(cell.textContent || '');
            } else if (action === 'copy-selected') {
                copySelectedGridCells();
            } else if (action === 'select-row') {
                gridSelectEntireRow(grid, rc.row);
            } else if (action === 'clear-selection') {
                state.selectedCells.clear();
                updateGridSelectionDisplay(grid);
            }
            hideGridContextMenu();
        };

        menu.addEventListener('click', (menuEvent) => {
            // @ts-ignore - closest method exists on EventTarget
            const button = menuEvent.target?.closest('button[data-action]');
            if (!button) {
                return;
            }
            onAction(button.dataset.action);
        });

        document.body.appendChild(menu);
        gridContextMenu = menu;

        const maxLeft = Math.max(0, window.innerWidth - menu.offsetWidth - 4);
        const maxTop = Math.max(0, window.innerHeight - menu.offsetHeight - 4);
        menu.style.left = `${Math.min(event.clientX, maxLeft)}px`;
        menu.style.top = `${Math.min(event.clientY, maxTop)}px`;
    });

    document.addEventListener('mouseup', () => {
        state.gridDragging = false;
    });

    document.addEventListener('mousedown', (event) => {
        if (!gridContextMenu) {
            return;
        }
        // @ts-ignore - closest exists on EventTarget in DOM API
        if (event.target?.closest('.grid-context-menu')) {
            return;
        }
        hideGridContextMenu();
    });

    // Keyboard interactions
    grid.addEventListener('keydown', (event) => {
        if (!state.activeCell) {
            return;
        }

        const handledKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
        if (!handledKeys.has(event.key) && !(event.ctrlKey && event.key.toUpperCase() === 'A')) {
            return;
        }

        const allCells = Array.from(grid.querySelectorAll('td, .virtual-grid-td')).map((cell) => getRowCol(cell)).filter(Boolean);
        if (!allCells.length) {
            return;
        }

        const maxRow = Math.max(...allCells.map((rc) => rc.row));
        const maxCol = Math.max(...allCells.map((rc) => rc.col));

        let newRow = state.activeCell.row;
        let newCol = state.activeCell.col;

        if (event.key === 'ArrowUp') {
            newRow = Math.max(0, newRow - 1);
        } else if (event.key === 'ArrowDown') {
            newRow = Math.min(maxRow, newRow + 1);
        } else if (event.key === 'ArrowLeft') {
            newCol = Math.max(0, newCol - 1);
        } else if (event.key === 'ArrowRight') {
            newCol = Math.min(maxCol, newCol + 1);
        } else if (event.key === 'Home') {
            newCol = 0;
        } else if (event.key === 'End') {
            newCol = maxCol;
        } else if (event.key === 'PageUp') {
            newRow = Math.max(0, newRow - 10);
        } else if (event.key === 'PageDown') {
            newRow = Math.min(maxRow, newRow + 10);
        } else if (event.ctrlKey && event.key.toUpperCase() === 'A') {
            event.preventDefault();
            state.selectedCells.clear();
            allCells.forEach((rc) => {
                state.selectedCells.add(getGridCellKey(rc.row, rc.col));
            });
            updateGridSelectionDisplay(grid);
            return;
        }

        if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
            gridSelectRange(grid, state.activeCell, { row: newRow, col: newCol });
        } else {
            state.selectedCells.clear();
            state.selectedCells.add(getGridCellKey(newRow, newCol));
            gridSetActiveCell(grid, container, newRow, newCol);
        }

        event.preventDefault();
    });

    gridActivateInitialCell(grid);
    updateGridSelectionDisplay(grid);
}

/**
 * 활성 셀을 뷰포트 안에 위치시키기
 */
function bringActiveCellIntoView(container) {
    if (!state.activeCell) {
        return;
    }

    const cell = container.querySelector(`[data-row="${state.activeCell.row}"][data-col="${state.activeCell.col}"]`);
    if (!cell) {
        return;
    }

    const body = container.querySelector('.virtual-grid-body');
    if (body) {
        const cellRect = cell.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();

        if (cellRect.top < bodyRect.top) {
            body.scrollTop -= bodyRect.top - cellRect.top;
        } else if (cellRect.bottom > bodyRect.bottom) {
            body.scrollTop += cellRect.bottom - bodyRect.bottom;
        }
    }
}

