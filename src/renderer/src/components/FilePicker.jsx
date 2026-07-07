import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from './base-ui/card'
import { Button } from './base-ui/button'
import { Badge } from './base-ui/badge'
import { cn } from '../lib/utils'

function FilePicker({ onFileLoad }) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [loadedFile, setLoadedFile] = useState(null)

  const handleBrowse = useCallback(async () => {
    if (!window.electronAPI) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.loadFile()
      if (!result.canceled && result.data) {
        setLoadedFile({
          name: result.fileName || 'spreadsheet.xlsx',
          size: result.fileSize || 0,
        })
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
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    handleBrowse()
  }, [handleBrowse])

  const handleRemove = useCallback((e) => {
    e.stopPropagation()
    setLoadedFile(null)
    setError(null)
  }, [])

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <div className="file-upload-wrapper">
      <Card
        className={cn(
          'file-upload-card',
          isDragging && 'file-upload-card-dragging',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !loadedFile && handleBrowse()}
      >
        <CardHeader>
          <div className="file-upload-header-text">
            <h2>Load Excel</h2>
            <p>Drop your spreadsheet or click to browse</p>
          </div>
        </CardHeader>
        <CardContent
          className={cn(
            'file-upload-dropzone',
            isDragging && 'file-upload-dropzone-active',
          )}
        >
          <div className="file-upload-stripes" />

          {!loadedFile ? (
            <>
              <div className="file-upload-icon-circle">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <h3 className="file-upload-title">
                Click to upload <span>or drag and drop</span>
              </h3>
              <p className="file-upload-hint">.xlsx and .xls files</p>
              <Button
                type="button"
                variant="secondary"
                className="file-upload-browse-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  handleBrowse()
                }}
              >
                Browse Files
              </Button>
            </>
          ) : (
            <div className="file-upload-loaded" onClick={(e) => e.stopPropagation()}>
              <div className="file-upload-loaded-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="file-upload-loaded-info">
                <p className="file-upload-loaded-name">{loadedFile.name}</p>
                <p className="file-upload-loaded-size">{formatFileSize(loadedFile.size)}</p>
              </div>
              <Badge variant="secondary" className="file-upload-done-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Loaded
              </Badge>
              <button className="file-upload-remove" onClick={handleRemove} title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="file-upload-error">{error}</div>
      )}
    </div>
  )
}

export default FilePicker
