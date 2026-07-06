import React, { useState, useEffect, useCallback } from 'react'
import FilePicker from './components/FilePicker'
import SetupView from './components/SetupView'
import TabStrip from './components/TabStrip'
import { useToast } from './components/Toast'
import ActivitiesCard from './components/right-panel/ActivitiesCard'
import EventReminders from './components/right-panel/EventReminders'
import TodoList from './components/right-panel/TodoList'
import { FaBell } from 'react-icons/fa'

function App() {
  const { addToast, ToastContainer } = useToast()
  const [view, setView] = useState('landing')
  const [excelData, setExcelData] = useState(null)
  const [columnMapping, setColumnMapping] = useState({})
  const [batchSize, setBatchSize] = useState(20)
  const [stats, setStats] = useState({ total: 0, processed: 0, remaining: 0, inBatch: 0 })
  const [batchRows, setBatchRows] = useState([])
  const [activeTab, setActiveTab] = useState(null)
  const [isComplete, setIsComplete] = useState(false)
  const [batchComplete, setBatchComplete] = useState(false)
  const [isAdditional, setIsAdditional] = useState(false)
  const [rowCount, setRowCount] = useState(0)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [updateVersion, setUpdateVersion] = useState(null)
  const [localMasterPath, setLocalMasterPath] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [masterRows, setMasterRows] = useState([])
  const [masterLoading, setMasterLoading] = useState(false)
  const [pushedByName, setPushedByName] = useState('')
  const [scriptUrl, setScriptUrl] = useState('')
  const [scriptUrlInput, setScriptUrlInput] = useState('')

  useEffect(() => {
    const checkRecovery = async () => {
      if (!window.electronAPI) return
      const state = await window.electronAPI.getState()
      if (state) {
        if (state.localMasterPath) setLocalMasterPath(state.localMasterPath)
        if (state.appVersion) setAppVersion(state.appVersion)
        if (state.scriptUrl) {
          setScriptUrl(state.scriptUrl)
          setScriptUrlInput(state.scriptUrl)
        }
      }
      const nameResult = await window.electronAPI.masterGetName()
      if (nameResult && nameResult.pushedByName) {
        setPushedByName(nameResult.pushedByName)
      }
    }
    checkRecovery()
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return

    const onBatchCreated = (data) => {
      setBatchRows(data.batchRows)
      setStats(data.stats)
      setIsComplete(data.isComplete)
      setBatchComplete(false)
      if (data.batchRows.length > 0) {
        setActiveTab(data.batchRows[0].rowId)
      }
    }

    const onTagged = (data) => {
      setStats(data.stats)
      setIsComplete(data.isComplete)
      setBatchComplete(data.batchComplete)
      setBatchRows(prev => prev.map(row =>
        row.rowId === data.rowId ? { ...row, tag: data.tag } : row
      ))
    }

    const onTabClosed = (data) => {
      setBatchRows(prev => {
        const remaining = prev.filter(row => row.rowId !== data.rowId)
        setActiveTab(prevTab => {
          if (prevTab === data.rowId) {
            return remaining.length > 0 ? remaining[0].rowId : null
          }
          return prevTab
        })
        return remaining
      })
    }

    const onBatchCompleted = (data) => {
      setStats(data.stats)
      setIsComplete(true)
      setBatchComplete(true)
    }

    const onSwitchView = (data) => {
      setActiveTab(data.rowId)
    }

    const onNavigateHome = () => {
      setView('landing')
      setExcelData(null)
      setColumnMapping({})
      setBatchSize(20)
      setStats({ total: 0, processed: 0, remaining: 0, inBatch: 0 })
      setBatchRows([])
      setActiveTab(null)
      setIsComplete(false)
      setBatchComplete(false)
      setIsAdditional(false)
    }

    window.electronAPI.onBatchCreated(onBatchCreated)
    window.electronAPI.onRowTagged(onTagged)
    window.electronAPI.onTabClosed(onTabClosed)
    window.electronAPI.onBatchCompleted(onBatchCompleted)
    window.electronAPI.onSwitchView(onSwitchView)
    window.electronAPI.onNavigateHome(onNavigateHome)

    return () => {
      window.electronAPI.removeAllListeners('batch:created')
      window.electronAPI.removeAllListeners('row:tagged')
      window.electronAPI.removeAllListeners('tab:closed')
      window.electronAPI.removeAllListeners('batch:completed')
      window.electronAPI.removeAllListeners('ui:switch-view')
      window.electronAPI.removeAllListeners('navigate-home')
    }
  }, [batchRows])

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onUpdateChecking(() => setUpdateStatus('checking'))
    window.electronAPI.onUpdateAvailable((data) => {
      setUpdateStatus('available')
      setUpdateVersion(data.version)
    })
    window.electronAPI.onUpdateNotAvailable(() => setUpdateStatus(null))
    window.electronAPI.onUpdateDownloaded((data) => {
      setUpdateStatus('downloaded')
      setUpdateVersion(data.version)
    })
  }, [])

  const handleFileLoad = useCallback((data) => {
    setExcelData(data.data)
    setColumnMapping(data.columnMapping)
    setRowCount(data.rowCount || 0)
    setIsAdditional(false)
    setView('setup')
  }, [])

  const handleSetupComplete = useCallback(async (setupData) => {
    setColumnMapping(setupData.columnMapping)
    setBatchSize(setupData.batchSize)
    if (!window.electronAPI) return
    try {
      const setupResult = await window.electronAPI.completeSetup({
        filePath: setupData.filePath,
        sheetName: setupData.sheetName,
        columnMapping: setupData.columnMapping,
        batchSize: setupData.batchSize
      })
      if (!setupResult.success) {
        addToast('Setup failed: ' + (setupResult.error || 'Unknown error'), 'error')
        return
      }
      const startResult = await window.electronAPI.startBatch()
      if (startResult.success) {
        setView('batch')
        const state = await window.electronAPI.getState()
        setStats(state.stats)
        setBatchRows(state.batchRows)
        setBatchComplete(state.batchComplete)
        if (state.batchRows.length > 0) {
          setActiveTab(state.batchRows[0].rowId)
        }
      } else {
        addToast('Failed to start batch: ' + (startResult.error || 'No rows to process'), 'error')
      }
    } catch (err) {
      addToast('Error: ' + (err.message || err), 'error')
    }
  }, [])

  const handleAddFile = useCallback(async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.addFile()
    if (!result.canceled && result.data) {
      setExcelData(result.data)
      setColumnMapping(result.columnMapping)
      setRowCount(result.rowCount || 0)
      setIsAdditional(true)
      setView('setup')
    }
  }, [])

  const handleOpenLocalMaster = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.openLocalMaster()
  }, [])

  const handleOpenSharedFile = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.openSharedFile()
  }, [])

  const handleOpenMasterViewer = useCallback(async () => {
    if (!window.electronAPI) return
    setMasterLoading(true)
    setView('master')
    const result = await window.electronAPI.masterRead()
    if (result.success) {
      setMasterRows(result.rows)
    } else {
      addToast('Failed to read master file: ' + (result.error || 'Unknown error'), 'error')
      setMasterRows([])
    }
    setMasterLoading(false)
  }, [addToast])

  const handleDiscard = useCallback(async (row) => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.masterDiscard(row.name, row.website)
    if (result.success) {
      setMasterRows(prev => prev.filter(r => !(r.name === row.name && r.website === row.website)))
      addToast('Lead discarded', 'info')
    } else {
      addToast('Discard failed: ' + (result.error || 'Unknown error'), 'error')
    }
  }, [addToast])

  const handlePush = useCallback(async (row) => {
    if (!window.electronAPI) return
    if (!pushedByName.trim()) {
      addToast('Enter your name before pushing', 'error')
      return
    }
    const result = await window.electronAPI.masterPush({
      query: row.query || '',
      name: row.name || '',
      website: row.website || '',
      company_phone: row.company_phone || '',
      email: row.email || '',
      pushed_by: pushedByName.trim()
    })
    if (result.success) {
      setMasterRows(prev => prev.filter(r => !(r.name === row.name && r.website === row.website)))
      addToast('Lead pushed to shared sheet', 'success')
    } else {
      addToast('Push failed: ' + (result.error || 'Unknown error'), 'error')
    }
  }, [pushedByName, addToast])

  const handleSaveScriptUrl = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.masterSetScriptUrl(scriptUrlInput.trim())
    setScriptUrl(scriptUrlInput.trim())
    addToast('Apps Script URL saved', 'success')
  }, [scriptUrlInput, addToast])

  const handleTabClick = useCallback((rowId) => {
    setActiveTab(rowId)
    if (window.electronAPI) {
      window.electronAPI.focusRow(rowId)
    }
  }, [])

  const handleTabClose = useCallback((rowId) => {
    if (window.electronAPI) {
      window.electronAPI.closeTab(rowId)
    }
  }, [])

  const handleStartNewSession = useCallback(() => {
    setView('landing')
    setExcelData(null)
    setColumnMapping({})
    setBatchSize(20)
    setStats({ total: 0, processed: 0, remaining: 0, inBatch: 0 })
    setBatchRows([])
    setActiveTab(null)
    setIsComplete(false)
    setBatchComplete(false)
    setIsAdditional(false)
  }, [])

  const renderUpdateBanner = () => {
    if (!updateStatus || updateStatus === 'checking') return null
    return (
      <div className={`update-banner update-${updateStatus}`}>
        {updateStatus === 'available' && (
          <span>Update available (v{updateVersion}) - downloading...</span>
        )}
        {updateStatus === 'downloaded' && (
          <span>
            Update ready (v{updateVersion})
            <button className="btn btn-primary btn-sm" onClick={() => window.electronAPI.installUpdate()}>
              Restart Now
            </button>
          </span>
        )}
      </div>
    )
  }

  if (view === 'landing') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Quali</h1>
          <p className="app-subtitle">Lead Review Tool{appVersion ? ` — v${appVersion}` : ''}</p>
        </header>
        {renderUpdateBanner()}
        <main className="app-main landing-main">
          <div className="landing-left">
            <div className="landing-cards">
              <div className="master-card">
                <div className="master-card-icon">📊</div>
                <div className="master-card-info">
                  <h3>Local Master Excel</h3>
                  <p className="master-card-path">{localMasterPath || 'No file yet — start reviewing to create one'}</p>
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleOpenMasterViewer}>View</button>
                <button className="btn btn-secondary btn-sm" onClick={handleOpenLocalMaster}>Open</button>
              </div>
              <div className="master-card">
                <div className="master-card-icon">🌐</div>
                <div className="master-card-info">
                  <h3>Shared Master Sheet</h3>
                  <p className="master-card-path">Google Drive — all users</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleOpenSharedFile}>Open</button>
              </div>
            </div>
            <div className="landing-upload">
              <FilePicker onFileLoad={handleFileLoad} />
            </div>
          </div>
          <div className="landing-right">
            <ActivitiesCard
              headerIcon={<FaBell size={22} />}
              title="Notifications"
              subtitle="Recent activity"
              activities={[]}
            />
            <div className="landing-right-bottom">
              <EventReminders
                title="Follow-up Reminder"
                date=""
                initialReminders={[]}
              />
              <TodoList />
            </div>
          </div>
        </main>
        <ToastContainer />
      </div>
    )
  }

  if (view === 'setup' && excelData) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Quali</h1>
          <p className="app-subtitle">{isAdditional ? 'Add Another File' : 'Configure Review Session'}</p>
        </header>
        {renderUpdateBanner()}
        <main className="app-main">
          <SetupView
            excelData={excelData}
            columnMapping={columnMapping}
            rowCount={rowCount}
            onComplete={handleSetupComplete}
            onBack={() => {
              if (isAdditional) {
                setView('batch')
                setIsAdditional(false)
              } else {
                setView('landing')
              }
            }}
            isAdditional={isAdditional}
          />
        </main>
        <ToastContainer />
      </div>
    )
  }

  if (view === 'master') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Quali</h1>
          <p className="app-subtitle">Local Master Excel</p>
        </header>
        {renderUpdateBanner()}
        <main className="app-main master-view">
          <div className="master-toolbar">
            <button className="btn btn-secondary btn-sm" onClick={() => setView('landing')}>← Back</button>
            <div className="master-toolbar-right">
              <input
                type="text"
                className="master-name-input"
                value={pushedByName}
                onChange={(e) => {
                  setPushedByName(e.target.value)
                  window.electronAPI.masterSetName(e.target.value)
                }}
                placeholder="Your name (for pushed_by)"
              />
              <span className="master-row-count">{masterRows.length} leads</span>
            </div>
          </div>
          <div className="master-script-config">
            <label>Apps Script URL (for Push to work)</label>
            <div className="input-row">
              <input
                type="text"
                value={scriptUrlInput}
                onChange={(e) => setScriptUrlInput(e.target.value)}
                placeholder="Paste your Google Apps Script web app URL"
              />
              <button className="btn btn-primary btn-sm" onClick={handleSaveScriptUrl} disabled={!scriptUrlInput.trim() || scriptUrlInput.trim() === scriptUrl}>
                Save
              </button>
            </div>
            {scriptUrl && <span className="settings-hint">URL configured</span>}
          </div>
          {masterLoading ? (
            <div className="master-empty">Loading...</div>
          ) : masterRows.length === 0 ? (
            <div className="master-empty">No leads in local master Excel</div>
          ) : (
            <div className="master-table-wrapper">
              <table className="master-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Query</th>
                    <th>Website</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {masterRows.map((row, i) => {
                    const status = (row['Lead Status'] || '').toLowerCase()
                    const statusLabel = status === 'green' ? 'Good' : status === 'yellow' ? 'Maybe' : status === 'red' ? 'Bad' : row['Lead Status'] || ''
                    return (
                      <tr key={i}>
                        <td className="font-medium">{row.name || '—'}</td>
                        <td className="text-muted">{row.query || '—'}</td>
                        <td className="text-muted">{row.website || '—'}</td>
                        <td className="text-muted">{row.company_phone || '—'}</td>
                        <td className="text-muted">{row.email || '—'}</td>
                        <td>
                          {statusLabel ? (
                            <span className={`badge badge-${status}`}>{statusLabel}</span>
                          ) : (
                            <span className="badge badge-muted">—</span>
                          )}
                        </td>
                        <td className="text-right">
                          <button className="btn-discard" onClick={() => handleDiscard(row)} title="Discard">Discard</button>
                          <button className="btn-push" onClick={() => handlePush(row)} title="Push to shared sheet">Push</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="master-table-footer">
                <span>Total Candidates</span>
                <span>{masterRows.length}</span>
              </div>
            </div>
          )}
        </main>
        <ToastContainer />
      </div>
    )
  }

  if (view === 'batch') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Quali</h1>
          <div className="stats-bar">
            <span>{stats.processed} / {stats.total} reviewed</span>
            <span className="separator">|</span>
            <span>{stats.remaining} remaining</span>
            <span className="separator">|</span>
            <button className="btn-add-file" onClick={handleAddFile}>+ Add File</button>
          </div>
        </header>
        {renderUpdateBanner()}
        <main className="app-main batch-view">
          <TabStrip
            rows={batchRows}
            activeTab={activeTab}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
          />
          <div className="tab-content" />
        </main>
        {isComplete && (
          <div className="completion-overlay">
            <div className="completion-card">
              <h2>All Leads Reviewed!</h2>
              <p>You have reviewed all {stats.total} leads.</p>
              <div className="completion-actions">
                <button className="btn btn-primary" onClick={handleAddFile}>Add Another File</button>
                <button className="btn btn-secondary" onClick={handleStartNewSession}>Start New Session</button>
              </div>
            </div>
          </div>
        )}
        <ToastContainer />
      </div>
    )
  }

  return null
}

export default App
