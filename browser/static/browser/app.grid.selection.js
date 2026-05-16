/**
 * app.grid.selection.js - Grid selection helpers
 */

function getGridCellRowCol(cell) {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    return isNaN(row) || isNaN(col) ? null : { row, col };
}

function getGridCellKey(row, col) {
    return `${row},${col}`;
}

function updateGridSelectionDisplay(grid) {
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
    const selectedCells = Array.from(document.querySelectorAll('.result-grid td.is-selected, .virtual-grid-td.is-selected'));
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
