import React, { useState, useEffect, useCallback } from 'react'

function detectColumns(headers) {
  const aliases = {
    name: ['name', 'lead name', 'company name', 'business name', 'firm name', 'contact name'],
    query: ['query', 'search', 'search term', 'search query'],
    website: ['website', 'url', 'site', 'web', 'webpage'],
    company_phone: ['company_phone', 'company phone', 'phone', 'telephone', 'contact number', 'mobile', 'phone number', 'cell', 'tel'],
    email: ['email', 'e-mail', 'mail', 'contact email', 'email address']
  }
  const mapping = {}
  const normalized = headers.map(h => ({ original: h, norm: String(h).toLowerCase().trim().replace(/[\s_-]+/g, ' ') }))
  for (const [col, aliasList] of Object.entries(aliases)) {
    const found = normalized.find(n => aliasList.some(a => n.norm === a || n.norm.includes(a)))
    mapping[col] = found ? found.original : null
  }
  return mapping
}

function mapRowData(row, mapping) {
  const mapped = {}
  for (const [col, sourceCol] of Object.entries(mapping)) {
    mapped[col] = sourceCol && row[sourceCol] != null ? String(row[sourceCol]).trim() : ''
  }
  return mapped
}

function SetupView({ excelData, columnMapping: initialMapping, rowCount: maxRows, onComplete, onBack, isAdditional }) {
  const [selectedSheet, setSelectedSheet] = useState(excelData.defaultSheet || excelData.sheetNames[0])
  const [columnMapping, setColumnMapping] = useState(initialMapping || {})
  const [previewRows, setPreviewRows] = useState([])
  const [batchSize, setBatchSize] = useState(20)
  const [warnings, setWarnings] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const maxBatchSize = Math.max(maxRows || 1, 1)

  const currentSheet = excelData.sheets[selectedSheet]

  useEffect(() => {
    if (!currentSheet) return
    const mapping = detectColumns(currentSheet.headers)
    setColumnMapping(mapping)
    setPreviewRows(currentSheet.data.slice(0, 5).map(r => mapRowData(r, mapping)))
  }, [selectedSheet])

  useEffect(() => {
    const w = []
    if (!columnMapping.name) {
      w.push({ text: 'No "name" column found — cannot search without it', critical: true })
    }
    const missing = ['query', 'website', 'company_phone', 'email'].filter(c => !columnMapping[c])
    if (missing.length > 0) {
      w.push({ text: `Missing columns: ${missing.join(', ')} — those cells will be blank`, critical: false })
    }
    setWarnings(w)
  }, [columnMapping])

  const handleSubmit = useCallback(async () => {
    if (!selectedSheet || !columnMapping.name || isLoading) return
    setIsLoading(true)
    try {
      await onComplete({
        filePath: excelData.filePath,
        sheetName: selectedSheet,
        columnMapping,
        batchSize: parseInt(batchSize, 10) || 20
      })
    } finally {
      setIsLoading(false)
    }
  }, [excelData, selectedSheet, columnMapping, batchSize, onComplete, isLoading])

  const canStart = columnMapping.name && !warnings.some(w => w.critical)

  return (
    <div className="setup-view">
      <div className="setup-card">
        <h2>{isAdditional ? 'Add Another File' : 'Configure Review Session'}</h2>

        {excelData.sheetNames.length > 1 && (
          <div className="form-group">
            <label>Select Sheet</label>
            <select value={selectedSheet} onChange={(e) => setSelectedSheet(e.target.value)}>
              {excelData.sheetNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Column Mapping (auto-detected)</label>
          <div className="mapping-table">
            <div className="mapping-header">
              <span>Standard Column</span>
              <span>Source Column</span>
              <span>Status</span>
            </div>
            {['name', 'query', 'website', 'company_phone', 'email'].map(col => (
              <div key={col} className={`mapping-row ${columnMapping[col] ? 'found' : 'missing'}`}>
                <span className="mapping-label">{col}</span>
                <span className="mapping-source">{columnMapping[col] || '—'}</span>
                <span className={`mapping-status ${columnMapping[col] ? 'ok' : 'fail'}`}>
                  {columnMapping[col] ? '✓' : '✗'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {previewRows.length > 0 && (
          <div className="form-group">
            <label>Data Preview (first {previewRows.length} rows)</label>
            <div className="preview-table-wrapper">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>name</th>
                    <th>query</th>
                    <th>website</th>
                    <th>company_phone</th>
                    <th>email</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      <td title={row.name}>{row.name || <span className="empty-cell">—</span>}</td>
                      <td title={row.query}>{row.query || <span className="empty-cell">—</span>}</td>
                      <td title={row.website}>{row.website || <span className="empty-cell">—</span>}</td>
                      <td title={row.company_phone}>{row.company_phone || <span className="empty-cell">—</span>}</td>
                      <td title={row.email}>{row.email || <span className="empty-cell">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Batch Size ({maxBatchSize} rows available)</label>
          <div className="batch-size-control">
            <div className="batch-size-input">
              <input type="range" min="1" max={maxBatchSize} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
              <input type="number" min="1" max={maxBatchSize} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
            </div>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="warning">
            {warnings.map((w, i) => (
              <div key={i} className={w.critical ? 'warning-critical' : 'warning-info'}>{w.text}</div>
            ))}
          </div>
        )}

        <div className="setup-actions">
          <button className="btn btn-secondary" onClick={onBack} disabled={isLoading}>Back</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canStart || isLoading}>
            {isLoading ? 'Starting...' : (isAdditional ? 'Add to Session' : 'Start Review')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SetupView
