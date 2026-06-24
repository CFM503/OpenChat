// ============================================================================
// TaskBoard Component
// Kanban board for Agent tasks, task transitions, and real-time logs
// ============================================================================

import React, { useState } from 'react';
import type { AgentTask, TaskAction, TaskStatus } from '../core/types';
import { isValidTransition } from '../core/taskStateMachine';

interface TaskBoardProps {
  tasks: AgentTask[];
  onCreateTask: (title: string, description: string, assignee: string, priority: AgentTask['priority']) => void;
  onTaskAction: (taskId: string, action: TaskAction, payload?: string) => void;
}

export function TaskBoard({ tasks, onCreateTask, onTaskAction }: TaskBoardProps) {
  // Creation form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newPriority, setNewPriority] = useState<AgentTask['priority']>('medium');

  // Logs overlay/expansion state
  const [expandedTaskLogs, setExpandedTaskLogs] = useState<Record<string, boolean>>({});

  // Column definitions
  const columns: { status: TaskStatus; label: string; icon: React.ReactNode }[] = [
    {
      status: 'pending',
      label: 'Pending',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      status: 'running',
      label: 'Running',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="status-dot-active">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      ),
    },
    {
      status: 'success',
      label: 'Success',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-success)' }}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    {
      status: 'failed',
      label: 'Failed',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-error)' }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
    },
  ];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateTask(newTitle, newDesc, newAssignee || 'Agent-1', newPriority);
    // Reset fields
    setNewTitle('');
    setNewDesc('');
    setNewAssignee('');
    setNewPriority('medium');
    setShowCreateForm(false);
  };

  const toggleLogs = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedTaskLogs(prev => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with Add Task action */}
      <div className="task-create-trigger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Task Canvas / Board</h3>
        <button className="btn-primary" onClick={() => setShowCreateForm(true)} id="btn-create-task-open">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Task</span>
        </button>
      </div>

      {/* Kanban Columns */}
      <div className="kanban-board" id="kanban-board">
        {columns.map(col => {
          const colTasks = tasks.filter(t => t.status === col.status);
          return (
            <div key={col.status} className="kanban-column" data-status={col.status}>
              <div className="kanban-column-header">
                <span className="kanban-column-title">
                  {col.icon}
                  {col.label}
                </span>
                <span className="badge-count">{colTasks.length}</span>
              </div>
              <div className="kanban-tasks">
                {colTasks.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    No tasks
                  </div>
                ) : (
                  colTasks.map(task => (
                    <div key={task.id} className="task-card" onClick={(e) => toggleLogs(task.id, e)}>
                      <div className="task-card-header">
                        <span className="task-card-title">{task.title}</span>
                        <span className={`task-priority-badge ${task.priority}`}>{task.priority}</span>
                      </div>
                      {task.description && <p className="task-card-desc">{task.description}</p>}
                      
                      {/* Action buttons based on status machine */}
                      <div className="task-card-actions" onClick={e => e.stopPropagation()}>
                        {isValidTransition(task.status, 'START') && (
                          <button className="btn-task-action" onClick={() => onTaskAction(task.id, 'START')} data-action="START">
                            Start
                          </button>
                        )}
                        {isValidTransition(task.status, 'COMPLETE') && (
                          <button className="btn-task-action" style={{ borderColor: 'var(--color-success)' }} onClick={() => onTaskAction(task.id, 'COMPLETE', 'Outputs processed successfully.')} data-action="COMPLETE">
                            Complete
                          </button>
                        )}
                        {isValidTransition(task.status, 'FAIL') && (
                          <button className="btn-task-action" style={{ borderColor: 'var(--color-error)' }} onClick={() => onTaskAction(task.id, 'FAIL', 'Simulated execution error.')} data-action="FAIL">
                            Fail
                          </button>
                        )}
                        {isValidTransition(task.status, 'RETRY') && (
                          <button className="btn-task-action" onClick={() => onTaskAction(task.id, 'RETRY')} data-action="RETRY">
                            Retry
                          </button>
                        )}
                        {isValidTransition(task.status, 'CANCEL') && (
                          <button className="btn-task-action" style={{ color: 'var(--text-muted)' }} onClick={() => onTaskAction(task.id, 'CANCEL')} data-action="CANCEL">
                            Cancel
                          </button>
                        )}
                      </div>

                      {/* Display results or errors */}
                      {task.result && (
                        <div style={{ fontSize: '0.75rem', padding: '6px 8px', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid var(--color-success)', borderRadius: '4px', color: 'var(--color-success)' }}>
                          <strong>Output:</strong> {task.result}
                        </div>
                      )}
                      {task.error && (
                        <div style={{ fontSize: '0.75rem', padding: '6px 8px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid var(--color-error)', borderRadius: '4px', color: 'var(--color-error)' }}>
                          <strong>Error:</strong> {task.error}
                        </div>
                      )}

                      {/* Task Logs */}
                      {expandedTaskLogs[task.id] && (
                        <div className="task-card-logs">
                          {task.logs.map((log, idx) => (
                            <div key={idx} className={`task-log-item ${log.level}`}>
                              [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}] {log.message}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="task-card-meta">
                        <span className="task-assignee">👤 {task.assignee}</span>
                        <span>{new Date(task.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Creation Modal */}
      {showCreateForm && (
        <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Agent Task</h2>
              <button className="btn-icon" onClick={() => setShowCreateForm(false)} id="btn-create-task-close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="model-form" style={{ padding: '24px' }}>
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g. Implement user login API"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  id="task-title-input"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-input"
                  style={{ height: '80px', resize: 'none' }}
                  placeholder="Task specifications..."
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  id="task-desc-input"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Assignee (Agent)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Agent name"
                    value={newAssignee}
                    onChange={e => setNewAssignee(e.target.value)}
                    id="task-assignee-input"
                  />
                </div>
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    className="form-select"
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value as AgentTask['priority'])}
                    id="task-priority-select"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" id="task-submit-btn">
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
