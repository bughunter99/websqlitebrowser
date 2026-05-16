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
}
