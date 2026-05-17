/**
 * app.layout.js - Layout wiring
 */

function wireSidebarLayout() {
    const appShell = /** @type {HTMLElement | null} */ (document.querySelector('.app-shell'));
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const SIDEBAR_WIDTH_STORAGE_KEY = 'websqlitebrowser.sidebar.width';

    if (!appShell || !sidebarResizer) {
        return;
    }

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const resizerWidth = 8;
    const minSidebar = 240;
    const minMain = 420;

    const applySidebarWidth = (widthPx) => {
        if (window.matchMedia('(max-width: 960px)').matches) {
            appShell.style.gridTemplateColumns = '';
            return;
        }

        const rect = appShell.getBoundingClientRect();
        const maxSidebar = Math.max(minSidebar, rect.width - resizerWidth - minMain);
        const safeWidth = Math.max(minSidebar, Math.min(maxSidebar, widthPx));
        appShell.style.gridTemplateColumns = `${safeWidth}px ${resizerWidth}px minmax(0, 1fr)`;
    };

    try {
        const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || 0);
        if (storedWidth > 0) {
            applySidebarWidth(storedWidth);
        }
    } catch {
        // Ignore storage read failures.
    }

    const stopDragging = () => {
        if (!dragging) {
            return;
        }
        dragging = false;
        sidebarResizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    sidebarResizer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        dragging = true;
        startX = event.clientX;
        startWidth = document.querySelector('.sidebar')?.getBoundingClientRect().width || minSidebar;
        sidebarResizer.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        sidebarResizer.setPointerCapture(event.pointerId);
    });

    window.addEventListener('pointermove', (event) => {
        if (!dragging) {
            return;
        }
        const nextWidth = startWidth + (event.clientX - startX);
        applySidebarWidth(nextWidth);
        try {
            localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
        } catch {
            // Ignore storage write failures.
        }
    });

    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    window.addEventListener('resize', () => {
        if (window.matchMedia('(max-width: 960px)').matches) {
            appShell.style.gridTemplateColumns = '';
            return;
        }
        const sidebar = document.querySelector('.sidebar');
        const width = sidebar ? sidebar.getBoundingClientRect().width : minSidebar;
        applySidebarWidth(width);
    });

    const mainPanel = /** @type {HTMLElement | null} */ (document.querySelector('.main-panel'));
    const outputPanel = /** @type {HTMLElement | null} */ (document.querySelector('.workspace-output'));
    const outputResizer = /** @type {HTMLElement | null} */ (document.getElementById('output-resizer'));
    const OUTPUT_HEIGHT_STORAGE_KEY = 'websqlitebrowser.output.height';

    if (!mainPanel || !outputPanel || !outputResizer) {
        return;
    }

    let outputDragging = false;
    let outputStartY = 0;
    let outputStartHeight = 0;
    const minOutputHeight = 68;
    const minContentHeight = 220;

    const applyOutputHeight = (heightPx) => {
        if (window.matchMedia('(max-width: 960px)').matches) {
            outputPanel.style.height = '';
            return;
        }

        const panelRect = mainPanel.getBoundingClientRect();
        const maxOutputHeight = Math.max(minOutputHeight, panelRect.height - 8 - minContentHeight);
        const safeHeight = Math.max(minOutputHeight, Math.min(maxOutputHeight, heightPx));
        outputPanel.style.height = `${Math.round(safeHeight)}px`;
    };

    try {
        const storedOutputHeight = Number(localStorage.getItem(OUTPUT_HEIGHT_STORAGE_KEY) || 0);
        if (storedOutputHeight > 0) {
            applyOutputHeight(storedOutputHeight);
        }
    } catch {
        // Ignore storage read failures.
    }

    const stopOutputDragging = () => {
        if (!outputDragging) {
            return;
        }
        outputDragging = false;
        outputResizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    outputResizer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        outputDragging = true;
        outputStartY = event.clientY;
        outputStartHeight = outputPanel.getBoundingClientRect().height || minOutputHeight;
        outputResizer.classList.add('is-dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        outputResizer.setPointerCapture(event.pointerId);
    });

    window.addEventListener('pointermove', (event) => {
        if (!outputDragging) {
            return;
        }

        const nextHeight = outputStartHeight - (event.clientY - outputStartY);
        applyOutputHeight(nextHeight);
        try {
            localStorage.setItem(OUTPUT_HEIGHT_STORAGE_KEY, String(Math.round(nextHeight)));
        } catch {
            // Ignore storage write failures.
        }
    });

    window.addEventListener('pointerup', stopOutputDragging);
    window.addEventListener('pointercancel', stopOutputDragging);

    window.addEventListener('resize', () => {
        if (window.matchMedia('(max-width: 960px)').matches) {
            outputPanel.style.height = '';
            return;
        }
        const currentHeight = outputPanel.getBoundingClientRect().height || minOutputHeight;
        applyOutputHeight(currentHeight);
    });
}
