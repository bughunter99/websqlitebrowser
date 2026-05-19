/**
 * app.grid.selection.js - Grid selection helpers
 */

let activeGridElement = null;

function clearGridSelectionDisplay(grid) {
    if (!grid) {
        return;
    }
    grid.querySelectorAll('td, .virtual-grid-td').forEach((cell) => {
        cell.classList.remove('is-selected', 'is-active');
    });
}

function activateGridSelectionContext(grid, options = {}) {
    const preserveSelection = Boolean(options.preserveSelection);
    if (activeGridElement === grid) {
        return false;
    }

    clearGridSelectionDisplay(activeGridElement);
    activeGridElement = grid;

    if (!preserveSelection) {
        state.selectedCells.clear();
        state.activeCell = null;
        state.gridLastClickedCell = null;
    }

    return true;
}

function getGridCellRowCol(cell) {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    return isNaN(row) || isNaN(col) ? null : { row, col };
}

function getGridCellKey(row, col) {
    return `${row},${col}`;
}

function updateGridSelectionDisplay(grid) {
    if (!grid) {
        return;
    }

    if (state.selectedCells.size <= 1 && state.activeCell) {
        grid.querySelectorAll('.is-selected, .is-active').forEach((cell) => {
            cell.classList.remove('is-selected', 'is-active');
        });

        const activeCell = grid.querySelector(`[data-row="${state.activeCell.row}"][data-col="${state.activeCell.col}"]`);
        if (activeCell) {
            activeCell.classList.add('is-selected', 'is-active');
        }
        return;
    }

    grid.querySelectorAll('td, .virtual-grid-td').forEach((cell) => {
        const rc = getGridCellRowCol(cell);
        if (!rc) {
            return;
        }
        const key = getGridCellKey(rc.row, rc.col);
        cell.classList.toggle('is-selected', state.selectedCells.has(key));
        cell.classList.toggle('is-active', state.activeCell && state.activeCell.row === rc.row && state.activeCell.col === rc.col);
    });
}

function gridSelectRange(grid, start, end) {
    state.selectedCells.clear();
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            state.selectedCells.add(getGridCellKey(r, c));
        }
    }
    
    // 범위 선택 후 활성 셀을 끝점으로 업데이트
    state.activeCell = { row: end.row, col: end.col };
    updateGridSelectionDisplay(grid);
}

function gridSetActiveCell(grid, container, row, col) {
    state.activeCell = { row, col };
    updateGridSelectionDisplay(grid);
    bringActiveCellIntoView(container);
}

function gridSelectEntireRow(grid, rowIndex) {
    const rowCells = Array.from(grid.querySelectorAll(`[data-row="${rowIndex}"][data-col]`));
    if (!rowCells.length) {
        return;
    }

    state.selectedCells.clear();
    rowCells.forEach((cell) => {
        const rc = getGridCellRowCol(cell);
        if (rc) {
            state.selectedCells.add(getGridCellKey(rc.row, rc.col));
        }
    });

    const first = getGridCellRowCol(rowCells[0]);
    if (first) {
        state.activeCell = { row: first.row, col: first.col };
    }
    updateGridSelectionDisplay(grid);
}

function copySelectedGridCells() {
    const scope = activeGridElement || document;
    const selectedCells = Array.from(scope.querySelectorAll('.result-grid td.is-selected, .virtual-grid-td.is-selected'));
    if (!selectedCells.length) {
        return false;
    }

    const groupedRows = new Map();
    selectedCells
        // @ts-ignore - dataset is available on HTMLElement
        .sort((left, right) => Number(left.dataset.row) - Number(right.dataset.row) || Number(left.dataset.col) - Number(right.dataset.col))
        .forEach((cell) => {
            // @ts-ignore - dataset is available on Element
            const rowIndex = Number(cell.dataset.row);
            if (!groupedRows.has(rowIndex)) {
                groupedRows.set(rowIndex, []);
            }
            groupedRows.get(rowIndex).push(cell.textContent);
        });

    const clipboardText = Array.from(groupedRows.values()).map((row) => row.join('\t')).join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clipboardText).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = clipboardText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        });
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = clipboardText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    return true;
}

function gridActivateInitialCell(grid) {
    activateGridSelectionContext(grid, { preserveSelection: false });

    if (state.activeCell) {
        return;
    }

    const firstCell = grid.querySelector('td, .virtual-grid-td');
    if (!firstCell) {
        return;
    }

    const rc = getGridCellRowCol(firstCell);
    if (rc) {
        state.activeCell = { row: rc.row, col: rc.col };
    }
}
