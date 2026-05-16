type Row = Record<string, unknown>;

interface ExplorerEntry {
	name?: string;
	path?: string;
	type?: string;
	is_sqlite?: boolean;
	size_human?: string;
	modified_at?: string;
}

interface SortState {
	col: number;
	dir: 'asc' | 'desc';
}

interface CellPosition {
	row: number;
	col: number;
}

interface QueryResult {
	columns: string[];
	rows: Row[];
	rowsCount?: number;	row_count?: number;
	truncated?: boolean;	executedQuery?: string;
	requestId?: string;
	elapsed?: number;
	error?: string;
	errorLine?: number;
}

interface DatabaseInfo {
	name?: string;
	path?: string;
	tables?: TableInfo[];
}

interface TableInfo {
	name: string;
	columns?: ColumnInfo[];
	indexes?: IndexInfo[];
	sql?: string;
}

interface ColumnInfo {
	name: string;
	type?: string;
	notnull?: number;
	dflt_value?: string;
	pk?: number;
}

interface IndexInfo {
	name: string;
	table?: string;
	sql?: string;
}

interface AppState {
	currentPath: string;
	currentDatabase: DatabaseInfo | null;
	activeTab: string | null;
	loadedTables: Map<string, boolean>;
	tableTabIds: Map<string, string>;
	explorerFilter: string;
	lastTreeData: { entries?: ExplorerEntry[]; [key: string]: unknown } | null;
	selectedExplorerPath: string;
	activeCell: CellPosition | null;
	selectedCells: Set<string>;
	selectionStart: CellPosition | null;
	selectionEnd: CellPosition | null;
	gridDragging: boolean;
	gridLastClickedCell: CellPosition | null;
	queryPending?: boolean;
	chatPending?: boolean;
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
declare function sendChatMessage(): Promise<void>;
declare function testSettingsConnection(): Promise<void>;
declare function formatDateTime(value: Date): string;
declare function setStatus(leftText?: string, rightText?: string): void;
declare function outputLog(message: string, level?: string): void;
declare function renderResultContent(target: HTMLElement, columns: string[], rows: Row[]): void;
declare function renderTable(columns: string[], rows: Row[], sortState?: SortState | null): string;
declare function renderVirtualizedTable(target: HTMLElement, columns: string[], rows: Row[], sortState?: SortState | null): void;
declare function sortRowsByColumn(rows: Row[], columns: string[], sortState: SortState): Row[];
declare function sortBy(rows: Row[], column: string, direction: 'asc' | 'desc'): Row[];
declare function getInitialColumnWidthByHeader(headerText: string): number;
declare function renderChatResponse(data: any): string;
declare function renderDdlContent(tables: TableInfo[]): string;
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
declare function sendChatMessage(): Promise<void>;

declare global {
	interface Window {
		__queryCount?: number;
	}
}
