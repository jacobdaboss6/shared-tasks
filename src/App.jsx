import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

export default function App() {
  const [tasks, setTasks] = useState([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadTasks() {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (error) {
        setError(error.message)
      } else {
        setTasks(data ?? [])
        setError(null)
      }
      setLoading(false)
    }

    loadTasks()

    const channel = supabase
      .channel('tasks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        (payload) => {
          setTasks((current) => {
            if (payload.eventType === 'INSERT') {
              if (current.some((t) => t.id === payload.new.id)) return current
              return [payload.new, ...current].sort(
                (a, b) => new Date(b.created_at) - new Date(a.created_at)
              )
            }
            if (payload.eventType === 'UPDATE') {
              return current.map((t) =>
                t.id === payload.new.id ? payload.new : t
              )
            }
            if (payload.eventType === 'DELETE') {
              return current.filter((t) => t.id !== payload.old.id)
            }
            return current
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  async function addTask(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || adding) return

    setAdding(true)
    setError(null)
    const { error } = await supabase.from('tasks').insert({ title: trimmed })

    if (error) {
      setError(error.message)
    } else {
      setTitle('')
    }
    setAdding(false)
  }

  async function toggleTask(task) {
    const { error } = await supabase
      .from('tasks')
      .update({ completed: !task.completed })
      .eq('id', task.id)

    if (error) setError(error.message)
  }

  async function deleteTask(id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) setError(error.message)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Shared Tasks</h1>
        <p className="subtitle">Live-synced across every window.</p>
      </header>

      <form className="add-form" onSubmit={addTask}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="New task"
          disabled={adding}
        />
        <button type="submit" disabled={adding || !title.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="state">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="state empty">No tasks yet. Add one above.</div>
      ) : (
        <ul className="tasks">
          {tasks.map((task) => (
            <li
              key={task.id}
              className={task.completed ? 'task done' : 'task'}
            >
              <label className="task-main">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleTask(task)}
                />
                <span className="task-title">{task.title}</span>
              </label>
              <button
                type="button"
                className="delete"
                onClick={() => deleteTask(task.id)}
                aria-label={`Delete ${task.title}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
