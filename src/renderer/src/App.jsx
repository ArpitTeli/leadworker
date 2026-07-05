import React, { useState, useEffect, useCallback } from 'react'
import FilePicker from './components/FilePicker'
import SetupView from './components/SetupView'
import TabStrip from './components/TabStrip'
import { useToast } from './components/Toast'

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
  const [updateProgress, setUpdateProgress] = useState(0)

  useEffect(() => {
    const checkRecovery = async () => {
      if (!window.electronAPI) return
      const state = await window.electronAPI.getState()
      if (state && state.stats && state.stats.total > 0) {
        setStats(state.stats)
        setBatchRows(state.batchRows || [])
        setBatchSize(state.batchSize || 20)
        setIsComplete(state.isComplete)
        setBatchComplete(state.batchComplete)
        setColumnMapping(state.columnMapping || {})
        if (state.batchRows && state.batchRows.length > 0) {
          setView('batch')
          setActiveTab(state.batchRows[0]?.rowId)
        }
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
      setBatchRows(prev => prev.filter(row => row.rowId !== data.rowId))
      setActiveTab(prev => {
        if (prev === data.rowId) {
          const remaining = batchRows.filter(r => r.rowId !== data.rowId)
          return remaining.length > 0 ? remaining[0].rowId : null
        }
        return prev
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

    window.electronAPI.onBatchCreated(onBatchCreated)
    window.electronAPI.onRowTagged(onTagged)
    window.electronAPI.onTabClosed(onTabClosed)
    window.electronAPI.onBatchCompleted(onBatchCompleted)
    window.electronAPI.onSwitchView(onSwitchView)

    return () => {
      window.electronAPI.removeAllListeners('batch:created')
      window.electronAPI.removeAllListeners('row:tagged')
      window.electronAPI.removeAllListeners('tab:closed')
      window.electronAPI.removeAllListeners('batch:completed')
      window.electronAPI.removeAllListeners('ui:switch-view')
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
    window.electronAPI.onUpdateProgress((data) => setUpdateProgress(data.percent))
    window.electronAPI.onUpdateDownloaded((data) => {
      setUpdateStatus('downloaded')
      setUpdateVersion(data.version)
      setUpdateProgress(100)
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

  const handleExport = useCallback(async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.exportFile()
    if (result.success) {
      addToast(`Exported successfully to: ${result.filePath}`, 'success')
    } else if (result.canceled) {
      return
    } else {
      addToast(`Export failed: ${result.error}`, 'error')
    }
  }, [])

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
          <h1>LeadWorker</h1>
          <p className="app-subtitle">Lead Review Tool</p>
        </header>
        {renderUpdateBanner()}
        <main className="app-main">
          <FilePicker onFileLoad={handleFileLoad} />
        </main>
        <ToastContainer />
      </div>
    )
  }

  if (view === 'setup' && excelData) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>LeadWorker</h1>
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

  if (view === 'batch') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>LeadWorker</h1>
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
                <button className="btn btn-primary" onClick={handleExport}>Export to Excel</button>
                <button className="btn btn-secondary" onClick={handleAddFile}>Add Another File</button>
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
