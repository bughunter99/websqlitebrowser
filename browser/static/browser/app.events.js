wireExplorerPanel();
wirePanelButtons();
wireSettingsPanel();
wireChatPanel();
wireOutputPanel();
wireSidebarLayout();
wireGlobalShortcuts();

loadSettings();
loadTree(localStorage.getItem('websqlitebrowser.explorer.currentPath') || '');
outputLog(`VERSION ${window.APP_VERSION || 'unknown'}`);
outputLog('READY');
