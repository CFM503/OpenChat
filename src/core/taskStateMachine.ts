// ============================================================================
// Agent Task State Machine
// Implements a deterministic finite state machine for task lifecycle
// ============================================================================

import type { AgentTask, TaskStatus, TaskAction, TaskTransition, TaskLog } from './types';

/**
 * Valid state transitions for the task state machine.
 *
 * State diagram:
 *   ┌─────────┐  START   ┌─────────┐  COMPLETE  ┌─────────┐
 *   │ PENDING  │────────▶│ RUNNING  │───────────▶│ SUCCESS  │
 *   └─────────┘         └─────────┘            └─────────┘
 *        ▲                    │
 *        │  RETRY             │ FAIL
 *        │                    ▼
 *        │              ┌─────────┐
 *        └──────────────│ FAILED   │
 *                       └─────────┘
 *
 * CANCEL can be applied from PENDING or RUNNING (not modeled as
 * a separate state — it simply removes the task).
 */
const TRANSITIONS: TaskTransition[] = [
  { from: 'pending', action: 'START', to: 'running' },
  { from: 'running', action: 'COMPLETE', to: 'success' },
  { from: 'running', action: 'FAIL', to: 'failed' },
  { from: 'failed', action: 'RETRY', to: 'pending' },
];

/**
 * Checks whether a given transition is valid.
 */
export function isValidTransition(currentStatus: TaskStatus, action: TaskAction): boolean {
  if (action === 'CANCEL') {
    return currentStatus === 'pending' || currentStatus === 'running';
  }
  return TRANSITIONS.some(t => t.from === currentStatus && t.action === action);
}

/**
 * Gets the target state for a valid transition.
 */
export function getNextStatus(currentStatus: TaskStatus, action: TaskAction): TaskStatus | null {
  const transition = TRANSITIONS.find(t => t.from === currentStatus && t.action === action);
  return transition ? transition.to : null;
}

/**
 * Generates a unique ID.
 */
function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Creates a new AgentTask in PENDING status.
 */
export function createTask(
  title: string,
  description: string,
  assignee: string,
  priority: AgentTask['priority'] = 'medium'
): AgentTask {
  const now = Date.now();
  return {
    id: generateId(),
    title,
    description,
    status: 'pending',
    assignee,
    priority,
    createdAt: now,
    updatedAt: now,
    logs: [
      {
        timestamp: now,
        message: `Task created and assigned to ${assignee}`,
        level: 'info',
      },
    ],
  };
}

/**
 * Applies an action to a task, returning a new task with updated state.
 * Throws an error for invalid transitions.
 */
export function applyAction(task: AgentTask, action: TaskAction, payload?: string): AgentTask {
  if (action === 'CANCEL') {
    if (!isValidTransition(task.status, action)) {
      throw new TaskTransitionError(task.status, action);
    }
    const now = Date.now();
    return {
      ...task,
      status: 'failed',
      updatedAt: now,
      error: 'Cancelled by user',
      logs: [
        ...task.logs,
        { timestamp: now, message: 'Task cancelled', level: 'warn' },
      ],
    };
  }

  const nextStatus = getNextStatus(task.status, action);
  if (nextStatus === null) {
    throw new TaskTransitionError(task.status, action);
  }

  const now = Date.now();
  const newLog: TaskLog = {
    timestamp: now,
    message: getLogMessage(action, payload),
    level: getLogLevel(action),
  };

  const updates: Partial<AgentTask> = {
    status: nextStatus,
    updatedAt: now,
    logs: [...task.logs, newLog],
  };

  if (action === 'COMPLETE') {
    updates.result = payload ?? 'Task completed successfully';
  }

  if (action === 'FAIL') {
    updates.error = payload ?? 'Task failed with unknown error';
  }

  if (action === 'RETRY') {
    updates.error = undefined;
    updates.result = undefined;
  }

  return { ...task, ...updates };
}

/**
 * Custom error for invalid state transitions.
 */
export class TaskTransitionError extends Error {
  public readonly fromStatus: TaskStatus;
  public readonly action: TaskAction;

  constructor(fromStatus: TaskStatus, action: TaskAction) {
    super(`Invalid transition: cannot apply action "${action}" from status "${fromStatus}"`);
    this.name = 'TaskTransitionError';
    this.fromStatus = fromStatus;
    this.action = action;
  }
}

/**
 * TaskManager — manages a collection of tasks with state machine enforcement.
 */
export class TaskManager {
  private tasks: Map<string, AgentTask> = new Map();

  /**
   * Create and register a new task.
   */
  create(
    title: string,
    description: string,
    assignee: string,
    priority?: AgentTask['priority']
  ): AgentTask {
    const task = createTask(title, description, assignee, priority);
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Apply an action to a task by ID.
   */
  dispatch(taskId: string, action: TaskAction, payload?: string): AgentTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const updated = applyAction(task, action, payload);
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Get a task by ID.
   */
  getTask(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get all tasks, optionally filtered by status.
   */
  getTasks(status?: TaskStatus): AgentTask[] {
    const all = Array.from(this.tasks.values());
    if (status) {
      return all.filter(t => t.status === status);
    }
    return all;
  }

  /**
   * Get tasks grouped by status.
   */
  getTasksByStatus(): Record<TaskStatus, AgentTask[]> {
    return {
      pending: this.getTasks('pending'),
      running: this.getTasks('running'),
      success: this.getTasks('success'),
      failed: this.getTasks('failed'),
    };
  }

  /**
   * Remove a task by ID.
   */
  removeTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  /**
   * Simulate the full lifecycle of a task (for demo purposes).
   * Returns the task at each stage.
   */
  async simulateTaskLifecycle(
    title: string,
    description: string,
    assignee: string,
    delayMs: number = 1000
  ): Promise<AgentTask[]> {
    const stages: AgentTask[] = [];

    // Create
    const task = this.create(title, description, assignee, 'medium');
    stages.push({ ...task });

    // Start
    await delay(delayMs);
    const running = this.dispatch(task.id, 'START');
    stages.push({ ...running });

    // Complete
    await delay(delayMs);
    const completed = this.dispatch(task.id, 'COMPLETE', `${title} finished with output`);
    stages.push({ ...completed });

    return stages;
  }
}

// --- Helpers ---

function getLogMessage(action: TaskAction, payload?: string): string {
  switch (action) {
    case 'START':
      return 'Task execution started';
    case 'COMPLETE':
      return payload ? `Task completed: ${payload}` : 'Task completed successfully';
    case 'FAIL':
      return payload ? `Task failed: ${payload}` : 'Task failed with unknown error';
    case 'RETRY':
      return 'Task queued for retry';
    case 'CANCEL':
      return 'Task cancelled';
    default:
      return `Action: ${action}`;
  }
}

function getLogLevel(action: TaskAction): TaskLog['level'] {
  switch (action) {
    case 'START':
      return 'info';
    case 'COMPLETE':
      return 'success';
    case 'FAIL':
      return 'error';
    case 'RETRY':
      return 'warn';
    case 'CANCEL':
      return 'warn';
    default:
      return 'info';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
