import React, { useCallback } from 'react'

function TabStrip({ rows, activeTab, onTabClick, onTabClose }) {
  const truncateText = useCallback((text, maxLength = 22) => {
    if (!text) return ''
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
  }, [])

  const handleNav = useCallback((action) => {
    if (!window.electronAPI) return
    if (action === 'back') window.electronAPI.browserBack()
    else if (action === 'forward') window.electronAPI.browserForward()
    else if (action === 'refresh') window.electronAPI.browserRefresh()
  }, [])

  if (!rows || rows.length === 0) {
    return (
      <div className="tab-strip">
        <div className="tab active" style={{ cursor: 'default', color: '#555' }}>
          No tabs open
        </div>
      </div>
    )
  }

  return (
    <div className="tab-strip">
      <div className="tab-nav-buttons">
        <button className="tab-nav-btn" onClick={() => handleNav('back')} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <button className="tab-nav-btn" onClick={() => handleNav('forward')} title="Forward">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
          </svg>
        </button>
        <button className="tab-nav-btn" onClick={() => handleNav('refresh')} title="Refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
          </svg>
        </button>
      </div>
      {rows.map(row => (
        <div
          key={row.rowId}
          className={`tab ${activeTab === row.rowId ? 'active' : ''}`}
          onClick={() => onTabClick(row.rowId)}
        >
          {row.tag && (
            <span className={`tab-tag ${row.tag}`} />
          )}
          <span className="tab-name" title={row.searchValue}>
            {truncateText(row.searchValue)}
          </span>
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onTabClose(row.rowId)
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  )
}

export default TabStrip
