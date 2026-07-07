const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  FILE_LOAD: 'file:load',
  FILE_ADD: 'file:add',
  FILE_DETECT_COLUMNS: 'file:detect-columns',
  BATCH_START: 'batch:start',
  BATCH_NEXT: 'batch:next',
  BATCH_COMPLETED: 'batch:completed',
  ROW_TAG: 'row:tag',
  ROW_UNTAG: 'row:untag',
  ROW_TAGGED: 'row:tagged',
  ROW_FOCUS: 'row:focus',
  TAB_CLOSE: 'tab:close',
  TAB_CLOSED: 'tab:closed',
  STATE_GET: 'state:get',
  STATE_UPDATE: 'state:update',
  EXPORT_FILE: 'export:file',
  RESUME_SESSION: 'resume:session',
  SETUP_COMPLETE: 'setup:complete',
  UI_SWITCH_VIEW: 'ui:switch-view',
  BATCH_SIZE_UPDATE: 'batch:size:update',
  BATCH_CREATED: 'batch:created'
};

const electronAPI = {
  loadFile: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_LOAD),
  addFile: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_ADD),
  detectColumns: (filePath, sheetName) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DETECT_COLUMNS, { filePath, sheetName }),
  completeSetup: (data) => ipcRenderer.invoke(IPC_CHANNELS.SETUP_COMPLETE, data),

  startBatch: () => ipcRenderer.invoke(IPC_CHANNELS.BATCH_START),
  nextBatch: () => ipcRenderer.invoke(IPC_CHANNELS.BATCH_NEXT),
  updateBatchSize: (batchSize) => ipcRenderer.invoke(IPC_CHANNELS.BATCH_SIZE_UPDATE, { batchSize }),

  tagRow: (rowId, tag) => ipcRenderer.invoke(IPC_CHANNELS.ROW_TAG, { rowId, tag }),
  untagRow: (rowId) => ipcRenderer.invoke(IPC_CHANNELS.ROW_UNTAG, { rowId }),
  focusRow: (rowId) => ipcRenderer.invoke(IPC_CHANNELS.ROW_FOCUS, { rowId }),
  closeTab: (rowId) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, { rowId }),

  getState: () => ipcRenderer.invoke(IPC_CHANNELS.STATE_GET),
  refreshState: () => ipcRenderer.invoke(IPC_CHANNELS.STATE_UPDATE),

  exportFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_FILE),
  resumeSession: () => ipcRenderer.invoke(IPC_CHANNELS.RESUME_SESSION),

  installUpdate: () => ipcRenderer.invoke('update:install'),

  goHome: () => ipcRenderer.invoke('go-home'),
  openLocalMaster: () => ipcRenderer.invoke('open-local-master'),
  openSharedFile: () => ipcRenderer.invoke('open-shared-file'),

  masterRead: () => ipcRenderer.invoke('master-read'),
  masterStats: () => ipcRenderer.invoke('master-stats'),
  masterDiscard: (name, website) => ipcRenderer.invoke('master-discard', { name, website }),
  masterPush: (data) => ipcRenderer.invoke('master-push', data),
  masterSetScriptUrl: (scriptUrl) => ipcRenderer.invoke('master-set-script-url', { scriptUrl }),
  masterGetScriptUrl: () => ipcRenderer.invoke('master-get-script-url'),
  masterSetName: (pushedByName) => ipcRenderer.invoke('master-set-name', { pushedByName }),
  masterGetName: () => ipcRenderer.invoke('master-get-name'),
  masterPushCounts: () => ipcRenderer.invoke('master-push-counts'),
  masterActivities: () => ipcRenderer.invoke('master-activities'),
  masterUpdateComments: (data) => ipcRenderer.invoke('master-update-comments', data),
  todosGet: () => ipcRenderer.invoke('todos-get'),
  todosSave: (todos) => ipcRenderer.invoke('todos-save', { todos }),

  onBatchCreated: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.BATCH_CREATED, (event, data) => callback(data));
  },
  onRowTagged: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.ROW_TAGGED, (event, data) => callback(data));
  },
  onTabClosed: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.TAB_CLOSED, (event, data) => callback(data));
  },
  onBatchCompleted: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.BATCH_COMPLETED, (event, data) => callback(data));
  },
  onSwitchView: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.UI_SWITCH_VIEW, (event, data) => callback(data));
  },
  onNavigateHome: (callback) => {
    ipcRenderer.on('navigate-home', () => callback());
  },
  onUpdateChecking: (callback) => {
    ipcRenderer.on('update:checking', () => callback());
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update:available', (event, data) => callback(data));
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.on('update:not-available', () => callback());
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update:progress', (event, data) => callback(data));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update:downloaded', (event, data) => callback(data));
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
