const { app, BrowserWindow, BrowserView, screen, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { autoUpdater } = require('electron-updater');

// ── Constants ────────────────────────────────────────────────────────────────

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

const ROW_STATUS = {
  UNPROCESSED: 'unprocessed',
  IN_BATCH: 'in_batch',
  TAGGED: 'tagged',
  SKIPPED: 'skipped_no_data'
};

const STANDARD_COLUMNS = ['name', 'query', 'website', 'company_phone', 'email'];

const COLUMN_ALIASES = {
  name: ['name', 'lead name', 'company name', 'business name', 'firm name', 'contact name'],
  query: ['query', 'search', 'search term', 'search query'],
  website: ['website', 'url', 'site', 'web', 'webpage'],
  company_phone: ['company_phone', 'company phone', 'phone', 'telephone', 'contact number', 'mobile', 'phone number', 'cell', 'tel'],
  email: ['email', 'e-mail', 'mail', 'contact email', 'email address']
};

const STATUS_COLORS = {
  green: 'C6EFCE',
  yellow: 'FFEB9C',
  red: 'FFC7CE',
  blue: 'B4D8E7'
};

// ── Column Detection ─────────────────────────────────────────────────────────

function normalizeHeader(h) {
  return String(h).toLowerCase().trim().replace(/[\s_-]+/g, ' ');
}

function detectColumns(headers) {
  const mapping = {};
  const normalizedHeaders = headers.map(h => ({ original: h, normalized: normalizeHeader(h) }));

  for (const [standardCol, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = normalizedHeaders.find(nh =>
      aliases.some(alias => nh.normalized === alias || nh.normalized.includes(alias))
    );
    mapping[standardCol] = found ? found.original : null;
  }

  return mapping;
}

function mapRowData(row, columnMapping) {
  const mapped = {};
  for (const [standardCol, sourceCol] of Object.entries(columnMapping)) {
    mapped[standardCol] = sourceCol && row[sourceCol] != null ? String(row[sourceCol]).trim() : '';
  }
  return mapped;
}

// ── Excel I/O ────────────────────────────────────────────────────────────────

function readExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) throw new Error('No sheets found in the Excel file');

  const sheets = {};
  sheetNames.forEach(name => {
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    sheets[name] = { data, headers };
  });

  return { filePath, sheetNames, sheets, defaultSheet: sheetNames[0] };
}

// ── AppState ─────────────────────────────────────────────────────────────────

class AppState {
  constructor() {
    this.filePath = null;
    this.searchColumn = 'name';
    this.batchSize = 20;
    this.rows = [];
    this.currentBatch = [];
    this.processedCount = 0;
    this.totalCount = 0;
    this.columnMapping = {};
    this.localMasterPath = path.join(app.getPath('documents'), 'leadworker_master.xlsx');
    this.scriptUrl = 'https://script.google.com/macros/s/AKfycbxm2CFldmla-NbDy92Kbj3SvUVE6EqMXilJaO28J0wvY2bY5zCwJrS5oH6ZHOgdYeZM/exec';
    this.recoveryPath = path.join(app.getPath('userData'), 'recovery.json');
    this.configPath = path.join(app.getPath('userData'), 'config.json');
    this.loadConfig();
    this.loadRecovery();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.scriptUrl = cfg.scriptUrl || 'https://script.google.com/macros/s/AKfycbxm2CFldmla-NbDy92Kbj3SvUVE6EqMXilJaO28J0wvY2bY5zCwJrS5oH6ZHOgdYeZM/exec';
      }
    } catch (e) { /* ignore */ }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({
        scriptUrl: this.scriptUrl
      }, null, 2));
    } catch (e) { console.error('Config save failed:', e); }
  }

  loadFromExcel(filePath, sheetName, data, columnMapping) {
    this.filePath = filePath;
    this.columnMapping = columnMapping;
    this.searchColumn = 'name';

    const newRows = data.map((row, index) => {
      const mappedData = mapRowData(row, columnMapping);
      return {
        rowId: `row_${this.rows.length + index}_${Date.now()}`,
        originalData: row,
        mappedData,
        searchValue: mappedData.name,
        sourceFile: path.basename(filePath),
        status: mappedData.name ? ROW_STATUS.UNPROCESSED : ROW_STATUS.SKIPPED,
        tag: null,
        tabOpenedAt: null
      };
    });

    this.rows.push(...newRows);
    this.totalCount = this.rows.filter(r => r.status !== ROW_STATUS.SKIPPED).length;
    this.processedCount = this.rows.filter(r => r.status === ROW_STATUS.TAGGED).length;
    this.currentBatch = [];
    this.autosave();
  }

  getNextBatch(size) {
    const batchSize = size || this.batchSize;
    const batch = [];
    for (const row of this.rows) {
      if (batch.length >= batchSize) break;
      if (row.status === ROW_STATUS.UNPROCESSED) batch.push(row.rowId);
    }
    return batch;
  }

  startBatch() {
    const batch = this.getNextBatch();
    if (batch.length === 0) return null;
    batch.forEach(rowId => {
      const row = this.rows.find(r => r.rowId === rowId);
      if (row) { row.status = ROW_STATUS.IN_BATCH; row.tabOpenedAt = Date.now(); }
    });
    this.currentBatch = batch;
    this.autosave();
    return batch;
  }

  nextBatch() {
    this.currentBatch.forEach(rowId => {
      const row = this.rows.find(r => r.rowId === rowId);
      if (row && row.status === ROW_STATUS.IN_BATCH) {
        row.status = ROW_STATUS.UNPROCESSED;
        row.tag = null;
        row.tabOpenedAt = null;
      }
    });
    const batch = this.getNextBatch();
    if (batch.length === 0) { this.currentBatch = []; this.autosave(); return null; }
    batch.forEach(rowId => {
      const row = this.rows.find(r => r.rowId === rowId);
      if (row) { row.status = ROW_STATUS.IN_BATCH; row.tabOpenedAt = Date.now(); }
    });
    this.currentBatch = batch;
    this.autosave();
    return batch;
  }

  async tagRow(rowId, tag) {
    const row = this.rows.find(r => r.rowId === rowId);
    if (!row) return false;
    row.tag = tag;
    row.status = ROW_STATUS.TAGGED;
    this.processedCount = this.rows.filter(r => r.status === ROW_STATUS.TAGGED).length;
    this.autosave();
    await this.updateLocalMaster(row, tag);
    return true;
  }

  async updateLocalMaster(row, tag) {
    try {
      const masterFile = this.localMasterPath;
      let existingRows = [];
      if (fs.existsSync(masterFile)) {
        try {
          const wb = XLSX.readFile(masterFile);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          existingRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } catch (e) {
          console.error('Master file read failed, retrying in 200ms:', e.message);
          await new Promise(r => setTimeout(r, 200));
          try {
            const wb = XLSX.readFile(masterFile);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            existingRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          } catch (e2) {
            console.error('Master file read failed again, aborting write to preserve data:', e2.message);
            return;
          }
        }
      }
      const key = `${(row.mappedData?.name || '').toLowerCase()}|${(row.mappedData?.website || '').toLowerCase()}`;
      const existing = existingRows.find(r => {
        const rKey = `${(r.name || '').toLowerCase()}|${(r.website || '').toLowerCase()}`;
        return rKey === key;
      });
      const statusMap = { green: 'Green', yellow: 'Yellow', red: 'Red', blue: 'Blue' };
      if (existing) {
        existing['Lead Status'] = statusMap[tag] || '';
      } else {
        existingRows.push({
          query: row.mappedData?.query || '',
          name: row.mappedData?.name || '',
          website: row.mappedData?.website || '',
          company_phone: row.mappedData?.company_phone || '',
          email: row.mappedData?.email || '',
          'Lead Status': statusMap[tag] || ''
        });
      }
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status'];
      const wsData = [headers, ...existingRows.map(r => headers.map(h => r[h] || ''))];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Master Leads');
      fs.writeFileSync(masterFile, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
    } catch (e) {
      console.error('Update local master failed:', e);
    }
  }

  untagRow(rowId) {
    const row = this.rows.find(r => r.rowId === rowId);
    if (!row || !row.tag) return false;
    row.tag = null;
    row.status = ROW_STATUS.IN_BATCH;
    this.processedCount = this.rows.filter(r => r.status === ROW_STATUS.TAGGED).length;
    this.autosave();
    return true;
  }

  removeTabFromBatch(rowId) {
    const index = this.currentBatch.indexOf(rowId);
    if (index === -1) return false;
    this.currentBatch.splice(index, 1);
    const row = this.rows.find(r => r.rowId === rowId);
    if (row) {
      if (row.status === ROW_STATUS.TAGGED) {
        this.processedCount = this.rows.filter(r => r.status === ROW_STATUS.TAGGED).length;
      }
      row.status = ROW_STATUS.UNPROCESSED;
      row.tag = null;
      row.tabOpenedAt = null;
    }
    this.autosave();
    return true;
  }

  isCurrentBatchComplete() {
    if (this.currentBatch.length === 0) return false;
    return this.currentBatch.every(rowId => {
      const row = this.rows.find(r => r.rowId === rowId);
      return row && row.status === ROW_STATUS.TAGGED;
    });
  }

  isAllProcessed() {
    return this.rows.every(row =>
      row.status === ROW_STATUS.TAGGED || row.status === ROW_STATUS.SKIPPED
    );
  }

  hasUnprocessedRows() {
    return this.rows.some(row => row.status === ROW_STATUS.UNPROCESSED);
  }

  getBatchRows() {
    return this.currentBatch.map(rowId => {
      const row = this.rows.find(r => r.rowId === rowId);
      return row ? {
        rowId: row.rowId,
        searchValue: row.searchValue,
        displayName: row.mappedData?.name || row.searchValue,
        status: row.status,
        tag: row.tag
      } : null;
    }).filter(Boolean);
  }

  getStats() {
    return {
      total: this.totalCount,
      processed: this.processedCount,
      remaining: this.totalCount - this.processedCount,
      inBatch: this.currentBatch.length
    };
  }

  updateBatchSize(newSize) { this.batchSize = newSize; this.autosave(); }

  getAllTaggedRows() {
    return this.rows.filter(r => r.status === ROW_STATUS.TAGGED).map(row => ({
      mappedData: row.mappedData || { name: row.searchValue || '', query: '', website: '', company_phone: '', email: '' },
      tag: row.tag
    }));
  }

  getAllRows() {
    return this.rows.map(row => ({
      mappedData: row.mappedData || { name: row.searchValue || '', query: '', website: '', company_phone: '', email: '' },
      tag: row.tag
    }));
  }

  autosave() {
    try {
      fs.writeFileSync(this.recoveryPath, JSON.stringify({
        filePath: this.filePath,
        searchColumn: this.searchColumn,
        batchSize: this.batchSize,
        rows: this.rows,
        currentBatch: this.currentBatch,
        processedCount: this.processedCount,
        totalCount: this.totalCount,
        columnMapping: this.columnMapping,
        savedAt: Date.now()
      }, null, 2));
    } catch (err) { console.error('Autosave failed:', err); }
  }

  loadRecovery() {
    try {
      if (fs.existsSync(this.recoveryPath)) {
        const data = JSON.parse(fs.readFileSync(this.recoveryPath, 'utf-8'));
        this.filePath = data.filePath;
        this.searchColumn = data.searchColumn || 'name';
        this.batchSize = data.batchSize || 20;
        this.rows = (data.rows || []).map(row => {
          if (!row.mappedData) {
            row.mappedData = { name: row.searchValue || '', query: '', website: '', company_phone: '', email: '' };
          }
          return row;
        });
        this.currentBatch = data.currentBatch || [];
        this.processedCount = data.processedCount || 0;
        this.totalCount = data.totalCount || 0;
        this.columnMapping = data.columnMapping || {};
        return true;
      }
    } catch (err) { console.error('Recovery load failed:', err); }
    return false;
  }
}

const state = new AppState();

// ── BrowserView Management ───────────────────────────────────────────────────

let mainWindow = null;
let miniPlayerWindow = null;
let browserViews = new Map();
const TAB_STRIP_HEIGHT = 38;

function getPreloadPath() {
  const isDev = !app.isPackaged;
  return path.join(__dirname, isDev ? '../preload.js' : '../preload/preload.js');
}

function getRendererPath() {
  if (!app.isPackaged) return null;
  return path.join(__dirname, '../src/renderer/index.html');
}

function getMiniPlayerPath() {
  if (!app.isPackaged) return null;
  return path.join(__dirname, '../src/mini-player/index.html');
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send(channel, ...args);
  }
}

function updateBrowserViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  browserViews.forEach((view) => {
    try { view.setBounds({ x: 0, y: TAB_STRIP_HEIGHT, width, height: height - TAB_STRIP_HEIGHT }); } catch (e) {}
  });
}

function createBrowserViews(rowIds) {
  rowIds.forEach(rowId => {
    const row = state.rows.find(r => r.rowId === rowId);
    if (!row || !row.searchValue) return;

    const view = new BrowserView({
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    view.webContents.loadURL(`https://www.google.com/search?q=${encodeURIComponent(row.searchValue)}`);
    browserViews.set(rowId, view);
  });

  if (mainWindow && !mainWindow.isDestroyed() && rowIds.length > 0) {
    const firstView = browserViews.get(rowIds[0]);
    if (firstView) {
      mainWindow.addBrowserView(firstView);
      updateBrowserViewBounds();
    }
  }
}

function destroyAllBrowserViews() {
  browserViews.forEach((view) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.removeBrowserView(view); } catch (e) {}
    }
    try { view.webContents.close(); } catch (e) {}
  });
  browserViews.clear();
}

function switchToView(rowId) {
  const view = browserViews.get(rowId);
  if (!view || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.getBrowserViews().forEach(v => {
    try { mainWindow.removeBrowserView(v); } catch (e) {}
  });
  mainWindow.addBrowserView(view);
  updateBrowserViewBounds();
  mainWindow.focus();
}

function closeBrowserView(rowId) {
  const view = browserViews.get(rowId);
  if (!view) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.removeBrowserView(view); } catch (e) {}
  }
  try { view.webContents.close(); } catch (e) {}
  browserViews.delete(rowId);

  const remaining = Array.from(browserViews.values());
  if (remaining.length > 0) {
    mainWindow.addBrowserView(remaining[remaining.length - 1]);
    updateBrowserViewBounds();
  }
}

function createMiniPlayerWindow() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.focus();
    return;
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  miniPlayerWindow = new BrowserWindow({
    width: 380, height: 520,
    x: sw - 400, y: sh - 540,
    frame: false, alwaysOnTop: true, resizable: true,
    transparent: false, skipTaskbar: true,
    title: 'Lead Review - Mini Player',
    backgroundColor: '#1e1e1e',
    webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false }
  });
  if (!app.isPackaged) {
    miniPlayerWindow.loadURL('http://localhost:5173/mini-player/');
  } else {
    miniPlayerWindow.loadFile(getMiniPlayerPath());
  }
  miniPlayerWindow.on('closed', () => { miniPlayerWindow = null; });
}

function performExport(exportPath) {
  try {
    let existingRows = [];

    if (fs.existsSync(exportPath)) {
      try {
        const existingWb = XLSX.readFile(exportPath);
        const existingSheet = existingWb.Sheets[existingWb.SheetNames[0]];
        existingRows = XLSX.utils.sheet_to_json(existingSheet, { defval: '' });
      } catch (e) {
        existingRows = [];
      }
    }

    const newTagged = state.getAllRows();
    const lookup = new Map();

    existingRows.forEach(row => {
      const key = `${(row.name || '').toLowerCase()}|${(row.website || '').toLowerCase()}`;
      lookup.set(key, { ...row });
    });

    newTagged.forEach(({ mappedData, tag }) => {
      const key = `${(mappedData.name || '').toLowerCase()}|${(mappedData.website || '').toLowerCase()}`;
      const existing = lookup.get(key);
      if (existing) {
        if (tag) {
          existing['Lead Status'] = tag.charAt(0).toUpperCase() + tag.slice(1);
          existing._tag = tag;
        }
      } else {
        lookup.set(key, {
          ...mappedData,
          'Lead Status': tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : '',
          _tag: tag
        });
      }
    });

    const outputHeaders = [...STANDARD_COLUMNS, 'Lead Status'];
    const wsData = [outputHeaders];
    const styles = [];

    lookup.forEach((row) => {
      const rowData = outputHeaders.map(h => row[h] !== undefined ? row[h] : '');
      wsData.push(rowData);
      const tag = (row._tag || '').toLowerCase();
      if (tag && STATUS_COLORS[tag]) {
        styles.push({ row: wsData.length - 1, color: STATUS_COLORS[tag] });
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    styles.forEach(({ row, color }) => {
      for (let col = 0; col < outputHeaders.length; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
        ws[cellRef].s = {
          fill: { patternType: 'solid', fgColor: { rgb: color } }
        };
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reviewed Leads');
    fs.writeFileSync(exportPath, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));

    return { success: true, filePath: exportPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── IPC Setup ────────────────────────────────────────────────────────────────

function setupIPC(win) {
  mainWindow = win;

  mainWindow.on('minimize', () => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.hide();
  });
  mainWindow.on('restore', () => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.show();
  });
  mainWindow.on('resize', updateBrowserViewBounds);

  ipcMain.handle(IPC_CHANNELS.FILE_LOAD, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Excel File',
      filters: [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    try {
      const filePath = result.filePaths[0];
      const excelData = readExcel(filePath);
      const firstSheet = excelData.sheets[excelData.defaultSheet];
      const columnMapping = detectColumns(firstSheet.headers);
      return {
        canceled: false,
        data: excelData,
        columnMapping,
        previewRows: firstSheet.data.slice(0, 5).map(r => mapRowData(r, columnMapping)),
        rowCount: firstSheet.data.length
      };
    } catch (err) {
      return { canceled: true, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_ADD, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add Another Excel File',
      filters: [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    try {
      const filePath = result.filePaths[0];
      const excelData = readExcel(filePath);
      const firstSheet = excelData.sheets[excelData.defaultSheet];
      const columnMapping = detectColumns(firstSheet.headers);
      return {
        canceled: false,
        data: excelData,
        columnMapping,
        previewRows: firstSheet.data.slice(0, 5).map(r => mapRowData(r, columnMapping)),
        rowCount: firstSheet.data.length
      };
    } catch (err) {
      return { canceled: true, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETUP_COMPLETE, (event, { filePath, sheetName, columnMapping, batchSize }) => {
    try {
      const wb = readExcel(filePath);
      const sheet = wb.sheets[sheetName];
      if (!sheet || !sheet.data) {
        return { success: false, error: `Sheet "${sheetName}" not found in file` };
      }
      state.loadFromExcel(filePath, sheetName, sheet.data, columnMapping);
      state.updateBatchSize(batchSize);
      return { success: true, stats: state.getStats() };
    } catch (err) {
      console.error('SETUP_COMPLETE failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BATCH_START, () => {
    try {
      const batch = state.startBatch();
      if (!batch) return { success: false, error: 'No unprocessed rows available' };

      createMiniPlayerWindow();
      sendToRenderer(IPC_CHANNELS.BATCH_CREATED, {
        batchRows: state.getBatchRows(),
        stats: state.getStats(),
        isComplete: state.isAllProcessed()
      });
      createBrowserViews(batch);
      return { success: true, batch };
    } catch (err) {
      console.error('BATCH_START failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BATCH_NEXT, () => {
    destroyAllBrowserViews();
    const batch = state.nextBatch();
    if (!batch) {
      sendToRenderer(IPC_CHANNELS.BATCH_COMPLETED, { stats: state.getStats() });
      return { success: false, completed: true };
    }
    sendToRenderer(IPC_CHANNELS.BATCH_CREATED, {
      batchRows: state.getBatchRows(),
      stats: state.getStats(),
      isComplete: state.isAllProcessed()
    });
    createBrowserViews(batch);
    return { success: true, batch };
  });

  ipcMain.handle(IPC_CHANNELS.ROW_TAG, async (event, { rowId, tag }) => {
    const success = await state.tagRow(rowId, tag);
    if (success) {
      sendToRenderer(IPC_CHANNELS.ROW_TAGGED, {
        rowId, tag,
        stats: state.getStats(),
        isComplete: state.isAllProcessed(),
        batchComplete: state.isCurrentBatchComplete()
      });
    }
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.ROW_UNTAG, (event, { rowId }) => {
    const success = state.untagRow(rowId);
    if (success) {
      sendToRenderer(IPC_CHANNELS.ROW_TAGGED, {
        rowId, tag: null,
        stats: state.getStats(),
        isComplete: state.isAllProcessed(),
        batchComplete: state.isCurrentBatchComplete()
      });
    }
    return { success };
  });

  // BUG FIX: actually call switchToView to swap the BrowserView
  ipcMain.handle(IPC_CHANNELS.ROW_FOCUS, (event, { rowId }) => {
    switchToView(rowId);
    sendToRenderer(IPC_CHANNELS.UI_SWITCH_VIEW, { rowId });
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (event, { rowId }) => {
    state.removeTabFromBatch(rowId);
    closeBrowserView(rowId);
    sendToRenderer(IPC_CHANNELS.TAB_CLOSED, { rowId });
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.STATE_GET, () => ({
    stats: state.getStats(),
    batchRows: state.getBatchRows(),
    searchColumn: state.searchColumn,
    filePath: state.filePath,
    isComplete: state.isAllProcessed(),
    batchComplete: state.isCurrentBatchComplete(),
    batchSize: state.batchSize,
    hasUnprocessed: state.hasUnprocessedRows(),
    columnMapping: state.columnMapping,
    localMasterPath: state.localMasterPath,
    appVersion: app.getVersion(),
    scriptUrl: state.scriptUrl
  }));

  ipcMain.handle(IPC_CHANNELS.BATCH_SIZE_UPDATE, (event, { batchSize }) => {
    state.updateBatchSize(batchSize);
    return { success: true };
  });

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('go-home', () => {
    destroyAllBrowserViews();
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
      miniPlayerWindow.close();
    }
    sendToRenderer('navigate-home');
    return { success: true };
  });

  ipcMain.handle('open-local-master', () => {
    const masterPath = state.localMasterPath;
    if (fs.existsSync(masterPath)) {
      shell.showItemInFolder(masterPath);
    } else {
      shell.showItemInFolder(path.dirname(masterPath));
    }
    return { success: true };
  });

  ipcMain.handle('open-shared-file', () => {
    shell.openExternal('https://docs.google.com/spreadsheets/d/1LWsb7dfw5vQ3DZcLgmN523ALoys9hqYfmft6v-bA9kU/edit?usp=sharing');
    return { success: true };
  });

  ipcMain.handle('master-read', () => {
    try {
      const masterFile = state.localMasterPath;
      if (!fs.existsSync(masterFile)) return { success: true, rows: [] };
      const wb = XLSX.readFile(masterFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      return { success: true, rows };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('master-discard', (event, { name, website }) => {
    try {
      const masterFile = state.localMasterPath;
      if (!fs.existsSync(masterFile)) return { success: false, error: 'Master file not found' };
      const wb = XLSX.readFile(masterFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const key = `${(name || '').toLowerCase()}|${(website || '').toLowerCase()}`;
      rows = rows.filter(r => {
        const rKey = `${(r.name || '').toLowerCase()}|${(r.website || '').toLowerCase()}`;
        return rKey !== key;
      });
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status'];
      const wsData = [headers, ...rows.map(r => headers.map(h => r[h] || ''))];
      const newWs = XLSX.utils.aoa_to_sheet(wsData);
      const newWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWb, newWs, 'Master Leads');
      fs.writeFileSync(masterFile, XLSX.write(newWb, { bookType: 'xlsx', type: 'buffer' }));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('master-push', async (event, { name, website, query, company_phone, email, pushed_by }) => {
    try {
      const masterFile = state.localMasterPath;
      if (!fs.existsSync(masterFile)) return { success: false, error: 'Master file not found' };
      if (state.scriptUrl) {
        try {
          await fetch(state.scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, name, website, company_phone, email, pushed_by, 'Lead Status': '' })
          });
        } catch (e) {
          console.error('Push to shared sheet failed:', e.message);
        }
      }
      const wb = XLSX.readFile(masterFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const key = `${(name || '').toLowerCase()}|${(website || '').toLowerCase()}`;
      rows = rows.filter(r => {
        const rKey = `${(r.name || '').toLowerCase()}|${(r.website || '').toLowerCase()}`;
        return rKey !== key;
      });
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status'];
      const wsData = [headers, ...rows.map(r => headers.map(h => r[h] || ''))];
      const newWs = XLSX.utils.aoa_to_sheet(wsData);
      const newWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWb, newWs, 'Master Leads');
      fs.writeFileSync(masterFile, XLSX.write(newWb, { bookType: 'xlsx', type: 'buffer' }));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('master-set-script-url', (event, { scriptUrl }) => {
    state.scriptUrl = scriptUrl || '';
    state.saveConfig();
    return { success: true };
  });

  ipcMain.handle('master-get-script-url', () => {
    return { scriptUrl: state.scriptUrl };
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_FILE, async () => {
    const defaultPath = state.filePath
      ? state.filePath.replace(/\.xlsx?$/i, '_reviewed.xlsx')
      : 'reviewed_leads.xlsx';

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Reviewed Leads',
      defaultPath,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return performExport(result.filePath);
  });

  ipcMain.handle(IPC_CHANNELS.RESUME_SESSION, () => state.loadRecovery());
}

// ── App Entry ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    title: 'LeadWorker', backgroundColor: '#1a1a1a',
    webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(getRendererPath());
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  setupIPC(mainWindow);

  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (msg) => console.log('[updater]', msg),
      warn: (msg) => console.warn('[updater]', msg),
      error: (msg) => console.error('[updater]', msg),
      debug: () => {}
    };

    autoUpdater.on('checking-for-update', () => {
      sendToRenderer('update:checking');
    });
    autoUpdater.on('update-available', (info) => {
      sendToRenderer('update:available', { version: info.version });
    });
    autoUpdater.on('update-not-available', () => {
      sendToRenderer('update:not-available');
    });
    autoUpdater.on('download-progress', (progress) => {
      sendToRenderer('update:progress', { percent: Math.round(progress.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      sendToRenderer('update:downloaded', { version: info.version });
    });
    autoUpdater.on('error', (err) => {
      console.error('[updater] Error:', err.message);
    });

    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Check for updates failed:', err.message);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(() => {
      const isDev = !app.isPackaged;
      mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 800, minHeight: 600,
        title: 'LeadWorker', backgroundColor: '#1a1a1a',
        webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false }
      });
      if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
      } else {
        mainWindow.loadFile(getRendererPath());
      }
      mainWindow.on('closed', () => { mainWindow = null; });
      setupIPC(mainWindow);
    });
  }
});
