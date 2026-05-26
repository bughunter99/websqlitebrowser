wireExplorerPanel();
wirePanelButtons();
wireSettingsPanel();
wireChatPanel();
wireOutputPanel();
wireSidebarLayout();
wireGlobalShortcuts();
wireMdEditor();

loadSettings();
loadTree(localStorage.getItem('websqlitebrowser.explorer.currentPath') || '');
outputLog(`VERSION ${window.APP_VERSION || 'unknown'}`);
outputLog('READY');
