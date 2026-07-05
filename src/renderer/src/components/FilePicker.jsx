import React, { useState, useCallback, useRef } from 'react'

function FilePicker({ onFileLoad }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const handleBrowse = useCallback(async () => {
    if (!window.electronAPI) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.loadFile()
      if (!result.canceled && result.data) {
        onFileLoad(result)
      } else if (result.error) {
        setError(result.error)
      }
    } catch (err) {
      setError(err.message || 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [onFileLoad])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
    handleBrowse()
  }, [handleBrowse])

  return (
    <div className="file-picker">
      <div
        className={`drop-zone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowse}
      >
        <div className="drop-zone-icon">
          {isLoading ? '⏳' : '📊'}
        </div>
        <div className="drop-zone-text">
          {isLoading ? 'Loading file...' : 'Drop Excel file here or click to browse'}
        </div>
        <div className="drop-zone-hint">
          Supports .xlsx and .xls files
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="file-input"
        accept=".xlsx,.xls"
      />

      {error && (
        <div className="warning">
          {error}
        </div>
      )}
    </div>
  )
}

export default FilePicker
