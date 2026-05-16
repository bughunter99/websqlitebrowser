type Row = Record<string, unknown>;

interface ExplorerEntry {
	name?: string;
	path?: string;
	type?: string;
	is_sqlite?: boolean;
	size_human?: string;
	modified_at?: string;
}

interface AppState {
	currentPath: string;
	currentDatabase: { name?: string; path?: string; tables?: unknown[] } | null;
	activeTab: string | null;
	loadedTables: Map<string, boolean>;
	tableTabIds: Map<string, string>;
	explorerFilter: string;
	lastTreeData: { entries?: ExplorerEntry[]; [key: string]: unknown } | null;
	selectedExplorerPath: string;
	activeCell: { row: number; col: number } | null;
	selectedCells: Set<string>;
	selectionStart: { row: number; col: number } | null;
	selectionEnd: { row: number; col: number } | null;
	gridDragging: boolean;
	gridLastClickedCell: { row: number; col: number } | null;
}

interface DomElements {
	explorerList: HTMLElement;
	explorerStatusbar: HTMLElement;
	explorerFilter: HTMLInputElement | null;
	panelStack: HTMLElement;
	currentPath: HTMLElement;
	tabs: HTMLElement;
	workspaceFrame: HTMLElement;
	welcomeTab: HTMLElement;
	chatResponse: HTMLElement;
	workspaceFile: HTMLElement;
	workspaceReload: HTMLElement | null;
	outputBody: HTMLElement;
	railButtons: HTMLElement[];
}

declare function requestJson(url: string, options?: RequestInit): Promise<any>;
declare function getSelectedExplorerRow(): HTMLElement | null;
declare function openDatabase(path: string): Promise<void>;
declare function loadTable(tableName: string, tabId?: string): Promise<void>;
declare function loadSettings(): Promise<void>;
declare function loadTree(path?: string): Promise<void>;
declare function runQuery(): Promise<void>;
declare function testSettingsConnection(): Promise<void>;
declare function formatDateTime(value: Date): string;
declare function setStatus(leftText?: string, rightText?: string): void;
declare function outputLog(message: string, level?: string): void;
declare function renderResultContent(target: HTMLElement, columns: string[], rows: Row[]): void;
declare function renderChatResponse(data: any): string;
declare function renderDdlContent(tables: unknown[]): string;
declare function attachGridInteractions(container: HTMLElement): void;
declare function copySelectedCells(): boolean;
declare function ensureTab(id: string, title: string, contentHtml?: string): void;
declare function activateTab(id: string): void;
declare function initQuerySplit(): void;
declare function initSqlHighlight(): void;
declare function setExplorerFilter(value: string): void;
declare function setPanel(target: string): void;
declare function hideGridContextMenu(): void;
declare function escapeHtml(value: unknown): string;
declare function highlightExplorerName(text: unknown, query: unknown): string;
