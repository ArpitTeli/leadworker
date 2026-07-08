import React, { useState } from 'react'
import { motion } from 'motion/react'
import bgImage from '../../assets/Qrux logo.png'

function LoginView({ onLogin }) {
  const [uid, setUid] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!uid.trim() || !password.trim()) {
      setError('Please enter both User ID and Password')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await onLogin({ uid: uid.trim(), password })
      if (!result.success) {
        setError(result.error || 'Invalid credentials')
      }
    } catch (err) {
      setError('Login failed — check your connection')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrapper" style={{ backgroundImage: `url(${bgImage})` }}>
      <motion.div
        className={`login-card ${isDragging ? 'login-card--dragging' : ''}`}
        drag
        dragElastic={0.1}
        dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
        initial={false}
        animate={{ x: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        <div className="login-drag-handle">
          <h2 className="login-title">Login to your account</h2>
          <p className="login-subtitle">Enter your credentials below to login</p>
        </div>
        <form onSubmit={handleSubmit} onPointerDown={(e) => e.stopPropagation()}>
          <div className="login-field">
            <label className="login-label">User ID</label>
            <input
              className="login-input"
              type="text"
              placeholder="Enter your User ID"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>
          <div className="login-field">
            <label className="login-label">Password</label>
            <input
              className="login-input"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

export default LoginView
