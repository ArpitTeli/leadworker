import React, { useCallback } from 'react'

function TabStrip({ rows, activeTab, onTabClick, onTabClose }) {
  const truncateText = useCallback((text, maxLength = 22) => {
    if (!text) return ''
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
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
