import { useMemo, useState, useEffect, useRef } from 'react'
import { SearchIcon, Plus, X, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '../base-ui/avatar'
import { Badge } from '../base-ui/badge'
import { Checkbox } from '../base-ui/checkbox'
import { Input } from '../base-ui/input'
import { Label } from '../base-ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../base-ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../base-ui/table'

const defaultFilters = {
  client: '',
  priority: 'all',
}

const priorityBadgeClass = {
  'High': 'badge-red',
  'Medium': 'badge-yellow',
  'Low': 'badge-green',
}

export default function TodoList() {
  const [filters, setFilters] = useState(defaultFilters)
  const [selectedIds, setSelectedIds] = useState([])
  const [items, setItems] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [newClient, setNewClient] = useState('')
  const [newTime, setNewTime] = useState('')
  const [newPriority, setNewPriority] = useState('Medium')
  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.todosGet().then((result) => {
      if (result && result.todos) setItems(result.todos)
      initialLoadDone.current = true
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI || !initialLoadDone.current) return
    window.electronAPI.todosSave(items)
  }, [items])

  const addItem = () => {
    const name = newClient.trim()
    if (!name) return
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setItems(prev => [...prev, {
      id: Date.now(),
      client: name,
      fallback: initials,
      time: newTime.trim() || '—',
      priority: newPriority,
    }])
    setNewClient('')
    setNewTime('')
    setNewPriority('Medium')
    setShowAdd(false)
  }

  const removeItem = (id) => {
    setItems(prev => prev.filter(item => item.id !== id))
    setSelectedIds(prev => prev.filter(sid => sid !== id))
  }

  const filteredItems = useMemo(() => {
    const query = filters.client.trim().toLowerCase()
    return items.filter((item) => {
      const matchesClient = query ? item.client.toLowerCase().includes(query) : true
      const matchesPriority = filters.priority === 'all' ? true : item.priority === filters.priority
      return matchesClient && matchesPriority
    })
  }, [filters, items])

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const visibleIds = filteredItems.map((item) => item.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIdSet.has(id))
  const someSelected = visibleIds.some((id) => selectedIdSet.has(id)) && !allSelected

  const updateFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }))

  const toggleAll = (checked) => {
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
    } else {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
    }
  }

  const toggleRow = (id, checked) => {
    setSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id]
      return prev.filter((item) => item !== id)
    })
  }

  return (
    <div className="todo-wrapper">
      <div className="todo-card">
        <div className="todo-header-row">
          <h3 className="todo-heading">Tasks</h3>
          <button className="todo-add-btn" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? <X size={14} /> : <Plus size={14} />}
            {showAdd ? 'Cancel' : 'Add'}
          </button>
        </div>

        {showAdd && (
          <div className="todo-add-form">
            <Input
              className="todo-add-input"
              value={newClient}
              onChange={(e) => setNewClient(e.target.value)}
              placeholder="Client / task name"
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              autoFocus
            />
            <Input
              className="todo-add-input"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              placeholder="Approx time (e.g. 2h)"
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
            />
            <div className="todo-add-actions">
              <Select value={newPriority} onValueChange={setNewPriority}>
                <SelectTrigger className="todo-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
              <button className="todo-save-btn" onClick={addItem} disabled={!newClient.trim()}>Save</button>
            </div>
          </div>
        )}

        <div className="todo-filters">
          <div className="todo-filter-group">
            <Label>Client</Label>
            <div className="todo-search-wrapper">
              <Input
                className="todo-search-input"
                value={filters.client}
                onChange={(e) => updateFilter('client', e.target.value)}
                placeholder="Search client"
                type="text"
              />
              <div className="todo-search-icon">
                <SearchIcon size={14} />
              </div>
            </div>
          </div>
          <div className="todo-filter-group">
            <Label>Priority</Label>
            <Select value={filters.priority} onValueChange={(val) => updateFilter('priority', val)}>
              <SelectTrigger className="todo-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Table className="todo-table">
          <TableHeader>
            <TableRow>
              <TableHead className="todo-th-checkbox">
                <Checkbox
                  checked={allSelected}
                  aria-checked={someSelected ? 'mixed' : allSelected}
                  onCheckedChange={(value) => toggleAll(!!value)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="todo-th">Sr.</TableHead>
              <TableHead className="todo-th">Client</TableHead>
              <TableHead className="todo-th">Approx Time</TableHead>
              <TableHead className="todo-th">Priority</TableHead>
              <TableHead className="todo-th todo-th-actions"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length > 0 ? (
              filteredItems.map((item, i) => {
                const isSelected = selectedIdSet.has(item.id)
                return (
                  <TableRow key={item.id} data-state={isSelected ? 'selected' : undefined} className="todo-row">
                    <TableCell className="todo-td">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(value) => toggleRow(item.id, !!value)}
                        aria-label={`Select ${item.client}`}
                      />
                    </TableCell>
                    <TableCell className="todo-td todo-td-muted">{i + 1}</TableCell>
                    <TableCell className="todo-td">
                      <div className="todo-client">
                        <Avatar className="todo-avatar">
                          <AvatarFallback>{item.fallback}</AvatarFallback>
                        </Avatar>
                        <span className="todo-client-name">{item.client}</span>
                      </div>
                    </TableCell>
                    <TableCell className="todo-td todo-td-muted">{item.time}</TableCell>
                    <TableCell className="todo-td">
                      <Badge className={priorityBadgeClass[item.priority]}>{item.priority}</Badge>
                    </TableCell>
                    <TableCell className="todo-td">
                      <button className="todo-delete-btn" onClick={() => removeItem(item.id)} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="todo-empty">No tasks yet</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
