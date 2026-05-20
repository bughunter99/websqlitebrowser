wireExplorerPanel();
wirePanelButtons();
wireSettingsPanel();
wireChatPanel();
wireOutputPanel();
wireSidebarLayout();
wireGlobalShortcuts();

loadSettings();
loadTree();
outputLog(`VERSION ${window.APP_VERSION || 'unknown'}`);
outputLog('READY');
