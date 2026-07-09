const { app, BrowserWindow, BrowserView, screen, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { autoUpdater } = require('electron-updater');

// ── Constants ────────────────────────────────────────────────────────────────

const IPC_CHANNELS = {
  FILE_LOAD: 'file:load',
  FILE_ADD: 'file:add',
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

const STATUS_COLORS = {
  green: 'C6EFCE',
  yellow: 'FFEB9C',
  red: 'FFC7CE',
  blue: 'B4D8E7'
};

const STANDARD_COLUMNS = ['name', 'query', 'website', 'company_phone', 'email'];

const COLUMN_ALIASES = {
  name: ['name', 'lead name', 'company name', 'business name', 'firm name', 'contact name'],
  query: ['query', 'search', 'search term', 'search query'],
  website: ['website', 'url', 'site', 'web', 'webpage'],
  company_phone: ['company_phone', 'company phone', 'phone', 'telephone', 'contact number', 'mobile', 'phone number', 'cell', 'tel'],
  email: ['email', 'e-mail', 'mail', 'contact email', 'email address']
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
    this.localMasterPath = path.join(app.getPath('documents'), 'quali_master.xlsx');
    this.scriptUrl = 'https://script.google.com/macros/s/AKfycbykxuCQoi6WnnTXKdid4Ql6mwET2C68sMKZCvh7frIcGz5Wxe5lW8YR6c7Yo2s1qhPx/exec';
    this.authScriptUrl = 'https://script.google.com/macros/s/AKfycbyhkpWsu7OoZrYFdAZxJZ74h0HYp0EkzNP21iCID9UHQBGc-Ugchx3m6M60GkTgDv8dtQ/exec';
    this.cloudMasterUrl = 'https://script.google.com/macros/s/AKfycbzDegegBDSQ8184y3qD_86vb4ZDokMQ6hYGx6UwbA_MjCUVTyIA7PwDLPw1sl1UCcD5RQ/exec';
    this.cloudMasterNames = new Set();
    this.cloudMasterPhones = new Set();
    this.pushedByName = '';
    this.authSession = null;
    this.activities = [];
    this.todos = [];
    this.recoveryPath = path.join(app.getPath('userData'), 'recovery.json');
    this.configPath = path.join(app.getPath('userData'), 'config.json');
    this.loadConfig();
    this.loadRecovery();
  }

  reset() {
    this.rows = [];
    this.currentBatch = [];
    this.processedCount = 0;
    this.totalCount = 0;
    this.filePath = null;
    this.columnMapping = {};
    this.batchSize = 20;
    try {
      if (fs.existsSync(this.recoveryPath)) {
        fs.unlinkSync(this.recoveryPath);
      }
    } catch (e) { /* ignore */ }
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.scriptUrl = cfg.scriptUrl || 'https://script.google.com/macros/s/AKfycbykxuCQoi6WnnTXKdid4Ql6mwET2C68sMKZCvh7frIcGz5Wxe5lW8YR6c7Yo2s1qhPx/exec';
        this.authScriptUrl = cfg.authScriptUrl || 'https://script.google.com/macros/s/AKfycbyhkpWsu7OoZrYFdAZxJZ74h0HYp0EkzNP21iCID9UHQBGc-Ugchx3m6M60GkTgDv8dtQ/exec';
        this.cloudMasterUrl = cfg.cloudMasterUrl || 'https://script.google.com/macros/s/AKfycbzDegegBDSQ8184y3qD_86vb4ZDokMQ6hYGx6UwbA_MjCUVTyIA7PwDLPw1sl1UCcD5RQ/exec';
        this.pushedByName = cfg.pushedByName || '';
        this.authSession = cfg.authSession || null;
        this.activities = cfg.activities || [];
        this.todos = cfg.todos || [];
      }
    } catch (e) { /* ignore */ }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({
        scriptUrl: this.scriptUrl,
        authScriptUrl: this.authScriptUrl,
        cloudMasterUrl: this.cloudMasterUrl,
        pushedByName: this.pushedByName || '',
        authSession: this.authSession || null,
        activities: this.activities || [],
        todos: this.todos || []
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

    const statusToTag = { 'green': 'green', 'yellow': 'yellow', 'red': 'red', 'blue': 'blue' };
    let tagLookup = {};
    try {
      if (fs.existsSync(this.localMasterPath)) {
        const wb = XLSX.readFile(this.localMasterPath);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const masterRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        for (const r of masterRows) {
          const name = String(r.name || '').trim().toLowerCase();
          const status = String(r['Lead Status'] || '').trim().toLowerCase();
          if (name && status && statusToTag[status]) {
            tagLookup[name] = statusToTag[status];
          }
        }
      }
    } catch (e) { /* ignore — start fresh */ }

    for (const row of newRows) {
      const name = String(row.mappedData?.name || '').trim().toLowerCase();
      if (name && tagLookup[name]) {
        row.tag = tagLookup[name];
        row.status = ROW_STATUS.TAGGED;
      }
    }

    const filtered = newRows.filter(row => {
      const name = String(row.mappedData?.name || '').trim().toLowerCase();
      const phone = String(row.mappedData?.company_phone || '').trim().replace(/^\+?91/, '');
      if (name && this.cloudMasterNames.has(name)) return false;
      if (phone && this.cloudMasterPhones.has(phone)) return false;
      return true;
    });
    const skippedByCloud = newRows.length - filtered.length;

    this.rows.push(...filtered);
    this.totalCount = this.rows.filter(r => r.status !== ROW_STATUS.SKIPPED).length;
    this.processedCount = this.rows.filter(r => r.status === ROW_STATUS.TAGGED).length;
    this.currentBatch = [];
    this.autosave();
    return { skippedByCloud };
  }

  async fetchCloudMaster() {
    if (!this.cloudMasterUrl) return { success: false, error: 'No cloud master URL configured' };
    try {
      const resp = await fetch(this.cloudMasterUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getTaggedNames' })
      });
      if (!resp.ok) return { success: false, error: `Server returned ${resp.status}` };
      const data = await resp.json();
      if (data.success && Array.isArray(data.taggedLeads)) {
        this.cloudMasterNames = new Set(data.taggedLeads.map(l => String(l.name || '').trim().toLowerCase()));
        this.cloudMasterPhones = new Set(data.taggedLeads.map(l => String(l.phone || '').trim().replace(/^\+?91/, '')));
      }
      return { success: true, count: this.cloudMasterNames.size };
    } catch (e) {
      return { success: false, error: 'Network error: ' + e.message };
    }
  }

  async syncToCloudMaster(name, phone, taggedBy, tag) {
    if (!this.cloudMasterUrl) return;
    try {
      await fetch(this.cloudMasterUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addTag', name, phone: String(phone || '').replace(/^\+?91/, ''), taggedBy, tag })
      });
    } catch (e) { /* non-critical, ignore */ }
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
    const tagName = row.mappedData?.name || '';
    const tagPhone = row.mappedData?.company_phone || '';
    const tagLabel = tag === 'green' ? 'Good' : tag === 'yellow' ? 'Maybe' : tag === 'red' ? 'Bad' : tag;
    this.syncToCloudMaster(tagName, tagPhone, this.pushedByName, tagLabel).catch(() => {});
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
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status', 'Comments'];
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

function getIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'QualiLogo.ico');
  }
  return path.join(__dirname, '..', 'QualiLogo.ico');
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
    title: 'Quali - Mini Player', icon: getIconPath(),
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
      const activity = { type: 'file', title: `Loaded "${path.basename(filePath)}"`, desc: `${firstSheet.data.length} leads found`, time: new Date().toISOString() };
      if (!state.activities) state.activities = [];
      state.activities.unshift(activity);
      if (state.activities.length > 50) state.activities = state.activities.slice(0, 50);
      state.saveConfig();
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
      const activity = { type: 'file', title: `Added "${path.basename(filePath)}"`, desc: `${firstSheet.data.length} leads loaded`, time: new Date().toISOString() };
      if (!state.activities) state.activities = [];
      state.activities.unshift(activity);
      if (state.activities.length > 50) state.activities = state.activities.slice(0, 50);
      state.saveConfig();
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

  ipcMain.handle(IPC_CHANNELS.SETUP_COMPLETE, (event, { filePath, sheetName, columnMapping, batchSize, isAdditional }) => {
    try {
      const wb = readExcel(filePath);
      const sheet = wb.sheets[sheetName];
      if (!sheet || !sheet.data) {
        return { success: false, error: `Sheet "${sheetName}" not found in file` };
      }
      if (!isAdditional) {
        state.reset();
      }
      const result = state.loadFromExcel(filePath, sheetName, sheet.data, columnMapping);
      state.updateBatchSize(batchSize);
      return { success: true, stats: state.getStats(), skippedByCloud: result?.skippedByCloud || 0 };
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
      const row = state.rows.find(r => r.rowId === rowId);
      const tagName = row ? (row.mappedData?.name || row.searchValue || 'lead') : 'lead';
      const tagLabel = tag === 'green' ? 'Good' : tag === 'yellow' ? 'Maybe' : tag === 'red' ? 'Bad' : tag;
      const activity = { type: 'tag', title: `Tagged "${tagName}" as ${tagLabel}`, desc: 'Lead status updated', time: new Date().toISOString() };
      if (!state.activities) state.activities = [];
      state.activities.unshift(activity);
      if (state.activities.length > 50) state.activities = state.activities.slice(0, 50);
      state.saveConfig();
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
    state.reset();
    sendToRenderer('navigate-home');
    return { success: true };
  });

  ipcMain.handle('clear-input', () => {
    destroyAllBrowserViews();
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
      miniPlayerWindow.close();
    }
    state.reset();
    return { success: true, stats: state.getStats() };
  });

  ipcMain.handle('auth-login', async (event, { uid, password }) => {
    try {
      const resp = await fetch(state.authScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', uid, password })
      });
      if (!resp.ok) {
        return { success: false, error: `Server returned ${resp.status}` };
      }
      const data = await resp.json();
      if (data.success) {
        state.authSession = { uid, displayName: data.displayName, loggedIn: true };
        state.pushedByName = data.displayName;
        state.saveConfig();
      }
      return data;
    } catch (e) {
      return { success: false, error: 'Network error: ' + e.message };
    }
  });

  ipcMain.handle('auth-logout', () => {
    state.authSession = null;
    state.pushedByName = '';
    state.saveConfig();
    return { success: true };
  });

  ipcMain.handle('auth-check', () => {
    if (state.authSession && state.authSession.loggedIn) {
      state.pushedByName = state.authSession.displayName;
      return { loggedIn: true, displayName: state.authSession.displayName, uid: state.authSession.uid };
    }
    return { loggedIn: false };
  });

  ipcMain.handle('cloud-master-fetch', async () => {
    return await state.fetchCloudMaster();
  });

  ipcMain.handle('cloud-master-set-url', (event, { url }) => {
    state.cloudMasterUrl = url || '';
    state.saveConfig();
    return { success: true };
  });

  ipcMain.handle('cloud-master-get-url', () => {
    return { url: state.cloudMasterUrl };
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

  ipcMain.handle('master-stats', () => {
    try {
      const masterFile = state.localMasterPath;
      if (!fs.existsSync(masterFile)) {
        return { success: true, totalLeads: 0, good: 0, maybe: 0, bad: 0, lastModified: null };
      }
      const wb = XLSX.readFile(masterFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const stats = { totalLeads: rows.length, good: 0, maybe: 0, bad: 0 };
      rows.forEach(r => {
        const s = (r['Lead Status'] || '').toLowerCase();
        if (s === 'green') stats.good++;
        else if (s === 'yellow') stats.maybe++;
        else if (s === 'red') stats.bad++;
      });
      let lastModified = null;
      try {
        const stat = fs.statSync(masterFile);
        lastModified = stat.mtime.toISOString();
      } catch (e) {}
      return { success: true, ...stats, lastModified };
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
      const activity = { type: 'discard', title: `Discarded "${name || 'lead'}"`, desc: 'Removed from local master', time: new Date().toISOString() };
      if (!state.activities) state.activities = [];
      state.activities.unshift(activity);
      if (state.activities.length > 50) state.activities = state.activities.slice(0, 50);
      state.saveConfig();
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status', 'Comments'];
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

  ipcMain.handle('master-update-comments', async (event, { name, website, comments }) => {
    try {
      const masterFile = state.localMasterPath;
      if (!fs.existsSync(masterFile)) return { success: false, error: 'Master file not found' };
      const wb = XLSX.readFile(masterFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const key = `${(name || '').toLowerCase()}|${(website || '').toLowerCase()}`;
      const row = rows.find(r => `${(r.name || '').toLowerCase()}|${(r.website || '').toLowerCase()}` === key);
      if (row) row['Comments'] = comments || '';
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status', 'Comments'];
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

  ipcMain.handle('master-add-lead', async (event, { name, website, company_phone, email, query }) => {
    try {
      const masterFile = state.localMasterPath;
      let existingRows = [];
      if (fs.existsSync(masterFile)) {
        try {
          const wb = XLSX.readFile(masterFile);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          existingRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } catch (e) {
          await new Promise(r => setTimeout(r, 200));
          try {
            const wb = XLSX.readFile(masterFile);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            existingRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          } catch (e2) {
            return { success: false, error: 'Failed to read master file' };
          }
        }
      }
      const hasAny = [name, website, company_phone, email, query].some(v => v && v.trim());
      if (!hasAny) return { success: false, error: 'At least one field is required' };
      const key = `${(name || '').toLowerCase()}|${(website || '').toLowerCase()}`;
      const existing = existingRows.find(r => `${(r.name || '').toLowerCase()}|${(r.website || '').toLowerCase()}` === key);
      if (existing) {
        existing['Lead Status'] = 'Good';
        if (query) existing['query'] = query;
        if (company_phone) existing['company_phone'] = company_phone;
        if (email) existing['email'] = email;
      } else {
        existingRows.push({
          query: query || '',
          name: name || '',
          website: website || '',
          company_phone: company_phone || '',
          email: email || '',
          'Lead Status': 'Good',
          'Comments': ''
        });
      }
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status', 'Comments'];
      const wsData = [headers, ...existingRows.map(r => headers.map(h => r[h] || ''))];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Master Leads');
      fs.writeFileSync(masterFile, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
      if (!existing) {
        state.activities.unshift({ type: 'add', title: `Added "${name || 'lead'}" manually`, desc: 'Lead added with Good status', time: new Date().toISOString() });
        if (state.activities.length > 50) state.activities = state.activities.slice(0, 50);
        state.saveConfig();
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('master-push', async (event, { name, website, query, company_phone, email, pushed_by, comments }) => {
    try {
      const masterFile = state.localMasterPath;
      if (!fs.existsSync(masterFile)) return { success: false, error: 'Master file not found' };
      if (!state.scriptUrl) return { success: false, error: 'No Apps Script URL configured' };
      let isDuplicate = false;
      try {
        const cleanPhone = String(company_phone || '').replace(/^\+?91/, '');
        const resp = await fetch(state.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, name, website, company_phone: cleanPhone, email, pushed_by, Comments: comments || '', 'Lead Status': '' })
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          return { success: false, error: `Apps Script returned ${resp.status}: ${text.substring(0, 200)}` };
        }
        const respData = await resp.json().catch(() => ({}));
        if (respData.duplicate) {
          isDuplicate = true;
        }
      } catch (e) {
        return { success: false, error: 'Network error: ' + e.message };
      }
      const activityType = isDuplicate ? 'push-duplicate' : 'push';
      const activity = { type: activityType, title: isDuplicate ? `"${name || 'lead'}" already in shared sheet` : `Pushed "${name || 'lead'}"`, desc: isDuplicate ? `Skipped — already pushed by another user` : `To shared sheet by ${pushed_by}`, time: new Date().toISOString() };
      if (!state.activities) state.activities = [];
      state.activities.unshift(activity);
      if (state.activities.length > 50) state.activities = state.activities.slice(0, 50);
      state.saveConfig();
      const wb = XLSX.readFile(masterFile);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const key = `${(name || '').toLowerCase()}|${(website || '').toLowerCase()}`;
      rows = rows.filter(r => {
        const rKey = `${(r.name || '').toLowerCase()}|${(r.website || '').toLowerCase()}`;
        return rKey !== key;
      });
      const headers = ['query', 'name', 'website', 'company_phone', 'email', 'Lead Status', 'Comments'];
      const wsData = [headers, ...rows.map(r => headers.map(h => r[h] || ''))];
      const newWs = XLSX.utils.aoa_to_sheet(wsData);
      const newWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWb, newWs, 'Master Leads');
      fs.writeFileSync(masterFile, XLSX.write(newWb, { bookType: 'xlsx', type: 'buffer' }));
      return { success: true, duplicate: isDuplicate };
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

  ipcMain.handle('master-set-name', (event, { pushedByName }) => {
    state.pushedByName = pushedByName || '';
    state.saveConfig();
    return { success: true };
  });

  ipcMain.handle('master-get-name', () => {
    return { pushedByName: state.pushedByName || '' };
  });

  ipcMain.handle('master-push-counts', async () => {
    console.log('[leaderboard] Fetching, scriptUrl:', state.scriptUrl ? state.scriptUrl.substring(0, 60) + '...' : 'NONE');
    if (!state.scriptUrl) return { pushCounts: {} };
    try {
      const resp = await fetch(state.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leaderboard' }),
        redirect: 'follow'
      });
      console.log('[leaderboard] Response status:', resp.status, 'ok:', resp.ok);
      const text = await resp.text();
      console.log('[leaderboard] Response body (first 500 chars):', text.substring(0, 500));
      const data = JSON.parse(text);
      console.log('[leaderboard] Parsed pushCounts:', JSON.stringify(data.pushCounts));
      return { pushCounts: data.pushCounts || {} };
    } catch (e) {
      console.error('[leaderboard] Error:', e.message);
      return { pushCounts: {} };
    }
  });

  ipcMain.handle('master-activities', () => {
    return { activities: state.activities || [] };
  });

  ipcMain.handle('todos-get', () => {
    return { todos: state.todos || [] };
  });

  ipcMain.handle('todos-save', (event, { todos }) => {
    state.todos = todos || [];
    state.saveConfig();
    return { success: true };
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
    title: 'Quali', backgroundColor: '#1a1a1a', icon: getIconPath(),
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
      console.log('[updater] Checking for updates...');
      sendToRenderer('update:checking');
    });
    autoUpdater.on('update-available', (info) => {
      console.log('[updater] Update available:', info.version);
      sendToRenderer('update:available', { version: info.version });
    });
    autoUpdater.on('update-not-available', () => {
      console.log('[updater] No update available');
      sendToRenderer('update:not-available');
    });
    autoUpdater.on('download-progress', (progress) => {
      console.log('[updater] Download progress:', Math.round(progress.percent) + '%');
      sendToRenderer('update:progress', { percent: Math.round(progress.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[updater] Update downloaded:', info.version);
      sendToRenderer('update:downloaded', { version: info.version });
    });
    autoUpdater.on('error', (err) => {
      console.error('[updater] Error:', err.message);
    });

    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[updater] Renderer loaded, checking for updates...');
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[updater] Check for updates failed:', err.message);
      });
    });

    if (!mainWindow.webContents.isLoading()) {
      console.log('[updater] Page already loaded, checking now...');
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[updater] Check for updates failed:', err.message);
      });
    }

    setTimeout(() => {
      console.log('[updater] Fallback check after 3s...');
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[updater] Fallback check failed:', err.message);
      });
    }, 3000);
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
        title: 'Quali', backgroundColor: '#1a1a1a', icon: getIconPath(),
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
