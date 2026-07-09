import React, { useState, useEffect, useCallback, useRef } from 'react'
import FilePicker from './components/FilePicker'
import SetupView from './components/SetupView'
import TabStrip from './components/TabStrip'
import LoginView from './components/LoginView'
import { useToast } from './components/Toast'
import ActivitiesCard from './components/right-panel/ActivitiesCard'
import TodoList from './components/right-panel/TodoList'
import MasterCard from './components/right-panel/MasterCard'
import CompetitionWidget from './components/right-panel/CompetitionWidget'
import AddLeadModal from './components/AddLeadModal'
import { FaBell } from 'react-icons/fa'
import { HiArrowRight } from 'react-icons/hi2'
import { X, FileText, BarChart3, CheckCircle, AlertCircle, XCircle, Calendar, Globe, Upload, Clock, Users } from 'lucide-react'

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
  const [masterStats, setMasterStats] = useState({ totalLeads: 0, good: 0, maybe: 0, bad: 0, lastModified: null })
  const [pushCounts, setPushCounts] = useState({})
  const [activities, setActivities] = useState([])
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [selectedCommentRow, setSelectedCommentRow] = useState(null)
  const [commentText, setCommentText] = useState('')
  const commentTimerRef = useRef(null)
  const [auth, setAuth] = useState({ loggedIn: false, displayName: '', uid: '' })
  const [authLoading, setAuthLoading] = useState(true)
  const [showAddLead, setShowAddLead] = useState(false)
  const [cloudMasterFiltered, setCloudMasterFiltered] = useState(0)

  useEffect(() => {
    const checkAuth = async () => {
      if (!window.electronAPI) { setAuthLoading(false); return }
      try {
        const result = await window.electronAPI.checkAuth()
        if (result.loggedIn) {
          setAuth({ loggedIn: true, displayName: result.displayName, uid: result.uid })
          setPushedByName(result.displayName)
        }
      } catch (e) { /* ignore */ }
      try {
        await window.electronAPI.fetchCloudMaster()
      } catch (e) { /* ignore */ }
      setAuthLoading(false)
    }
    checkAuth()
  }, [])

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
      const statsResult = await window.electronAPI.masterStats()
      if (statsResult && statsResult.success) {
        setMasterStats(statsResult)
      }
      const pushCountsResult = await window.electronAPI.masterPushCounts()
      if (pushCountsResult && pushCountsResult.pushCounts) {
        setPushCounts(pushCountsResult.pushCounts)
      }
      const activitiesResult = await window.electronAPI.masterActivities()
      if (activitiesResult && activitiesResult.activities) {
        setActivities(activitiesResult.activities)
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

  useEffect(() => {
    if (view === 'landing' && window.electronAPI) {
      const refresh = async () => {
        const actResult = await window.electronAPI.masterActivities()
        if (actResult && actResult.activities) setActivities(actResult.activities)
        const pcResult = await window.electronAPI.masterPushCounts()
        if (pcResult && pcResult.pushCounts) setPushCounts(pcResult.pushCounts)
        const statsResult = await window.electronAPI.masterStats()
        if (statsResult && statsResult.success) setMasterStats(statsResult)
      }
      refresh()
    }
  }, [view])

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
        batchSize: setupData.batchSize,
        isAdditional: isAdditional
      })
      if (!setupResult.success) {
        addToast('Setup failed: ' + (setupResult.error || 'Unknown error'), 'error')
        return
      }
      if (setupResult.skippedByCloud > 0) {
        setCloudMasterFiltered(setupResult.skippedByCloud)
        addToast(`${setupResult.skippedByCloud} lead(s) skipped — already tagged by others`, 'info')
      } else {
        setCloudMasterFiltered(0)
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

  const handleLogin = useCallback(async ({ uid, password }) => {
    const result = await window.electronAPI.login(uid, password)
    if (result.success) {
      setAuth({ loggedIn: true, displayName: result.displayName, uid })
      setPushedByName(result.displayName)
    }
    return result
  }, [])

  const handleLogout = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.logout()
    setAuth({ loggedIn: false, displayName: '', uid: '' })
    setPushedByName('')
    setView('landing')
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
      const actResult = await window.electronAPI.masterActivities()
      if (actResult && actResult.activities) setActivities(actResult.activities)
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
      pushed_by: pushedByName.trim(),
      comments: row.Comments || ''
    })
    if (result.success) {
      setMasterRows(prev => prev.filter(r => !(r.name === row.name && r.website === row.website)))
      if (result.duplicate) {
        addToast(`"${row.name}" already exists in shared sheet — skipped`, 'info')
      } else {
        addToast('Lead pushed to shared sheet', 'success')
      }
      const pcResult = await window.electronAPI.masterPushCounts()
      if (pcResult && pcResult.pushCounts) setPushCounts(pcResult.pushCounts)
      const actResult = await window.electronAPI.masterActivities()
      if (actResult && actResult.activities) setActivities(actResult.activities)
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
    setCloudMasterFiltered(0)
  }, [])

  const handleClearInput = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      await window.electronAPI.clearInput()
    } catch (e) { /* ignore */ }
    setExcelData(null)
    setColumnMapping({})
    setBatchSize(20)
    setStats({ total: 0, processed: 0, remaining: 0, inBatch: 0 })
    setBatchRows([])
    setActiveTab(null)
    setIsComplete(false)
    setBatchComplete(false)
    setIsAdditional(false)
    setCloudMasterFiltered(0)
    setView('landing')
  }, [])

  if (authLoading) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Quali</h1>
          <p className="app-subtitle">Lead Review Tool</p>
        </header>
        <main className="app-main">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--muted)' }}>
            Loading...
          </div>
        </main>
      </div>
    )
  }

  if (!auth.loggedIn) {
    return (
      <div className="app">
        <LoginView onLogin={handleLogin} />
        <ToastContainer />
      </div>
    )
  }

  const renderUpdateBanner = () => {
    if (!updateStatus || updateStatus === 'checking' || updateDismissed) return null
    return (
      <div className="update-banner">
        <div className="update-banner-content">
          <span className="update-banner-text">
            {updateStatus === 'available' && (
              <>Update available (v{updateVersion}) — downloading...</>
            )}
            {updateStatus === 'downloaded' && (
              <>Update ready (v{updateVersion})</>
            )}
          </span>
          {updateStatus === 'downloaded' && (
            <div className="update-banner-actions">
              <button className="update-banner-btn" onClick={() => window.electronAPI.installUpdate()}>
                Restart Now
                <HiArrowRight className="update-banner-btn-icon" />
              </button>
            </div>
          )}
        </div>
        <button className="update-banner-close" onClick={() => setUpdateDismissed(true)}>
          <X size={14} />
        </button>
      </div>
    )
  }

  if (view === 'landing') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Quali</h1>
          <p className="app-subtitle">Lead Review Tool{appVersion ? ` — v${appVersion}` : ''}</p>
          {auth.loggedIn && (
            <div className="header-user">
              <span className="header-username">{auth.displayName}</span>
              <button className="btn-logout" onClick={handleLogout}>Logout</button>
            </div>
          )}
        </header>
        {renderUpdateBanner()}
        <main className="app-main landing-main">
          <div className="landing-left">
            <div className="landing-cards">
              <MasterCard
                icon={<FileText size={20} />}
                title="Local Master Excel"
                miniGraph="M2 18C15 15 25 5 45 8C65 11 70 2 78 2"
                stats={[
                  { icon: <FileText size={14} />, label: 'File', value: <span className="mc-stat-text">{localMasterPath ? 'quali_master.xlsx' : 'No file yet'}</span> },
                  { icon: <BarChart3 size={14} />, label: 'Total Leads', value: <span className="mc-stat-bold">{masterStats.totalLeads}</span> },
                  { icon: <CheckCircle size={14} />, label: 'Good', value: <span className="mc-stat-green">{masterStats.good}</span> },
                  { icon: <AlertCircle size={14} />, label: 'Maybe', value: <span className="mc-stat-yellow">{masterStats.maybe}</span> },
                  { icon: <XCircle size={14} />, label: 'Bad', value: <span className="mc-stat-red">{masterStats.bad}</span> },
                  { icon: <Calendar size={14} />, label: 'Last Updated', value: <span className="mc-stat-text">{masterStats.lastModified ? new Date(masterStats.lastModified).toLocaleDateString() : '—'}</span> },
                ]}
                actions={
                  <div className="mc-btn-row">
                    <button className="mc-btn mc-btn-primary" onClick={handleOpenMasterViewer}>View</button>
                    <button className="mc-btn mc-btn-secondary" onClick={handleOpenLocalMaster}>Open</button>
                    <button className="mc-btn mc-btn-secondary" onClick={() => setShowAddLead(true)}>Add Lead</button>
                  </div>
                }
              />
              <MasterCard
                icon={<Globe size={20} />}
                title="Shared Master Sheet"
                miniGraph="M2 12C18 8 35 18 55 10C70 5 75 14 78 8"
                stats={[
                  { icon: <Globe size={14} />, label: 'URL', value: <span className="mc-stat-text">Google Drive — all users</span> },
                  { icon: <Upload size={14} />, label: 'Total Pushed', value: <span className="mc-stat-bold">—</span> },
                  { icon: <Clock size={14} />, label: 'Last Push', value: <span className="mc-stat-text">—</span> },
                  { icon: <Users size={14} />, label: 'Top Pusher', value: <span className="mc-stat-text">—</span> },
                ]}
                actions={
                  <div className="mc-btn-row">
                    <button className="mc-btn mc-btn-secondary" onClick={handleOpenSharedFile}>Open</button>
                  </div>
                }
              />
            </div>
            <div className="landing-upload">
              <FilePicker onFileLoad={handleFileLoad} />
            </div>
          </div>
          <div className="landing-center">
            <CompetitionWidget
              data={Object.entries(pushCounts).map(([name, leads]) => ({ name, leads }))}
            />
          </div>
          <div className="landing-right">
            <ActivitiesCard
              headerIcon={<FaBell size={22} />}
              title="Notifications"
              subtitle="Recent activity"
              activities={activities}
            />
            <div className="landing-right-bottom">
              <TodoList />
            </div>
          </div>
        </main>
        {showAddLead && <AddLeadModal onClose={() => { setShowAddLead(false); handleOpenMasterViewer() }} />}
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
          <div className="header-user">
            <span className="header-username">{auth.displayName}</span>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </div>
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
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddLead(true)}>+ Add Lead</button>
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
          <div className="master-script-config">
            <label>Cross-Qualifier Dedup (Cloud Master)</label>
            <div className="input-row">
              <span className="settings-hint">Active — leads tagged across all devices are deduplicated automatically</span>
              <button className="btn btn-secondary btn-sm" onClick={async () => {
                const r = await window.electronAPI.cloudMasterDebug()
                if (r.success) {
                  console.log('[CloudMaster Debug]', r.body)
                  addToast(`${r.count || 0} leads in cloud master`, 'success')
                } else {
                  addToast('Debug failed: ' + (r.error || ''), 'error')
                }
              }}>Test</button>
            </div>
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
                    <th>Comments</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {masterRows.map((row, i) => {
                    const status = (row['Lead Status'] || '').toLowerCase()
                    const statusLabel = status === 'green' ? 'Good' : status === 'yellow' ? 'Maybe' : status === 'red' ? 'Bad' : row['Lead Status'] || ''
                    return (
                      <tr key={i} style={{ cursor: 'pointer' }} onClick={() => { setSelectedCommentRow(row); setCommentText(row.Comments || '') }}>
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
                        <td className="text-muted">{row.Comments || '—'}</td>
                        <td className="text-right">
                          <button className="btn-discard" onClick={(e) => { e.stopPropagation(); handleDiscard(row) }} title="Discard">Discard</button>
                          <button className="btn-push" onClick={(e) => { e.stopPropagation(); handlePush(row) }} title="Push to shared sheet">Push</button>
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
        {selectedCommentRow && (
          <div className="comment-modal-overlay" onClick={() => setSelectedCommentRow(null)}>
            <div className="comment-modal" onClick={e => e.stopPropagation()}>
              <h3>{selectedCommentRow.name || 'Lead'}</h3>
              <textarea
                autoFocus
                value={commentText}
                onChange={(e) => {
                  const val = e.target.value
                  setCommentText(val)
                  setMasterRows(prev => prev.map(r =>
                    (r.name === selectedCommentRow.name && r.website === selectedCommentRow.website)
                      ? { ...r, Comments: val }
                      : r
                  ))
                  if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
                  commentTimerRef.current = setTimeout(() => {
                    window.electronAPI.masterUpdateComments({
                      name: selectedCommentRow.name,
                      website: selectedCommentRow.website,
                      comments: val
                    })
                  }, 500)
                }}
                placeholder="Add comments..."
              />
              <div className="comment-modal-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setSelectedCommentRow(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
        {showAddLead && <AddLeadModal onClose={() => { setShowAddLead(false); handleOpenMasterViewer() }} />}
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
            {cloudMasterFiltered > 0 && (
              <>
                <span className="separator">|</span>
                <span style={{ color: '#a78bfa' }}>{cloudMasterFiltered} filtered (cloud dedup)</span>
              </>
            )}
            <span className="separator">|</span>
            <button className="btn-add-file" onClick={handleAddFile}>+ Add File</button>
            <button className="btn-clear-input" onClick={handleClearInput}>Clear Input</button>
            <span className="separator">|</span>
            <span className="header-username">{auth.displayName}</span>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
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
