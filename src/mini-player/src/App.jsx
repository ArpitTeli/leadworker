import React, { useState, useEffect, useCallback } from 'react'

function App() {
  const [batchRows, setBatchRows] = useState([])
  const [stats, setStats] = useState({ total: 0, processed: 0, remaining: 0, inBatch: 0 })
  const [isComplete, setIsComplete] = useState(false)
  const [batchComplete, setBatchComplete] = useState(false)
  const [hasUnprocessed, setHasUnprocessed] = useState(true)

  useEffect(() => {
    const initState = async () => {
      if (!window.electronAPI) return
      const state = await window.electronAPI.getState()
      if (state) {
        setBatchRows(state.batchRows || [])
        setStats(state.stats)
        setIsComplete(state.isComplete)
        setBatchComplete(state.batchComplete)
        setHasUnprocessed(state.hasUnprocessed)
      }
    }
    initState()
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return

    const onBatchCreated = (data) => {
      setBatchRows(data.batchRows)
      setStats(data.stats)
      setIsComplete(data.isComplete)
      setBatchComplete(false)
      setHasUnprocessed(true)
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
    }

    const onBatchCompleted = (data) => {
      setStats(data.stats)
      setIsComplete(true)
      setBatchComplete(true)
    }

    window.electronAPI.onBatchCreated(onBatchCreated)
    window.electronAPI.onRowTagged(onTagged)
    window.electronAPI.onTabClosed(onTabClosed)
    window.electronAPI.onBatchCompleted(onBatchCompleted)

    return () => {
      window.electronAPI.removeAllListeners('batch:created')
      window.electronAPI.removeAllListeners('row:tagged')
      window.electronAPI.removeAllListeners('tab:closed')
      window.electronAPI.removeAllListeners('batch:completed')
    }
  }, [])

  const handleTag = useCallback(async (rowId, tag) => {
    if (!window.electronAPI) return
    await window.electronAPI.tagRow(rowId, tag)
  }, [])

  const handleFocus = useCallback(async (rowId) => {
    if (!window.electronAPI) return
    await window.electronAPI.focusRow(rowId)
  }, [])

  const handleNextBatch = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.nextBatch()
  }, [])

  const taggedCount = batchRows.filter(r => r.tag).length
  const allTagged = batchRows.length > 0 && taggedCount === batchRows.length

  return (
    <div className="mini-player">
      <div className="mini-player-header">
        <span className="mini-player-title">Lead Review</span>
        <span className="mini-player-stats">
          {stats.processed}/{stats.total}
        </span>
      </div>

      <div className="mini-player-list">
        {batchRows.length === 0 ? (
          <div className="mini-player-empty">No batch active</div>
        ) : (
          batchRows.map(row => (
            <div
              key={row.rowId}
              className={`mini-player-row ${row.tag ? 'tagged' : ''} ${row.tag ? row.tag : ''}`}
            >
              <span
                className="mini-player-row-name"
                onClick={() => handleFocus(row.rowId)}
                title={row.searchValue}
              >
                {row.searchValue || 'No data'}
              </span>
              <div className="mini-player-row-actions">
                <button
                  className={`tag-btn green ${row.tag === 'green' ? 'active' : ''}`}
                  onClick={() => handleTag(row.rowId, 'green')}
                  title="Green"
                />
                <button
                  className={`tag-btn yellow ${row.tag === 'yellow' ? 'active' : ''}`}
                  onClick={() => handleTag(row.rowId, 'yellow')}
                  title="Yellow"
                />
                <button
                  className={`tag-btn red ${row.tag === 'red' ? 'active' : ''}`}
                  onClick={() => handleTag(row.rowId, 'red')}
                  title="Red"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mini-player-footer">
        <div className="mini-player-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${batchRows.length > 0 ? (taggedCount / batchRows.length) * 100 : 0}%` }}
            />
          </div>
          <span className="progress-text">{taggedCount}/{batchRows.length} tagged</span>
        </div>
        <button
          className={`btn-next ${allTagged && hasUnprocessed ? '' : 'disabled'}`}
          onClick={handleNextBatch}
          disabled={!allTagged || !hasUnprocessed}
        >
          Next Batch
        </button>
      </div>
    </div>
  )
}

export default App
