import { useState, useCallback, useRef } from 'react';
import type { AgentTask, TaskAction } from '../core/types';
import { TaskManager } from '../core/taskStateMachine';
import { backendClient } from '../services/api';
import { uid } from '../lib/uid';

export function useTasks(
  activeModelId: string,
  /** Ref so chat can update without hook order cycles */
  isStreamingRef: React.MutableRefObject<boolean>,
  backendAvailableRef: React.MutableRefObject<boolean>,
  opts?: {
    ensureSession?: () => Promise<string | null>;
    onPendingPatch?: (p: {
      id: string;
      path: string;
      tool: 'file_write' | 'file_edit';
      oldContent: string;
      newContent: string;
      diffPreview?: string;
      taskId?: string;
    }) => void;
  },
) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const taskManagerRef = useRef(new TaskManager());
  const refresh = useCallback(() => {
    setTasks(taskManagerRef.current.getTasks());
  }, []);

  const handleCreateTask = useCallback(
    (title: string, description: string, assignee: string, priority: AgentTask['priority']) => {
      const task = taskManagerRef.current.create(title, description, assignee, priority);
      refresh();
      return task;
    },
    [refresh],
  );

  /** Create + START a task for chat bridge; returns task id */
  const createRunningTask = useCallback(
    (title: string, description: string): string | null => {
      try {
        const task = taskManagerRef.current.create(title, description, 'Agent', 'medium');
        taskManagerRef.current.dispatch(task.id, 'START');
        taskManagerRef.current.appendLog(task.id, 'Linked to chat agent turn', 'info');
        refresh();
        return task.id;
      } catch {
        return null;
      }
    },
    [refresh],
  );

  const handleTaskEvent = useCallback(
    (ev: {
      taskId: string;
      action: 'start' | 'log' | 'complete' | 'fail';
      message?: string;
      level?: 'info' | 'warn' | 'error' | 'success';
    }) => {
      const mgr = taskManagerRef.current;
      const exists = mgr.getTasks().some(t => t.id === ev.taskId);
      if (!exists) return;
      try {
        if (ev.action === 'log' && ev.message) {
          mgr.appendLog(ev.taskId, ev.message, ev.level || 'info');
        } else if (ev.action === 'start' && ev.message) {
          mgr.appendLog(ev.taskId, ev.message, 'info');
        } else if (ev.action === 'complete') {
          const t = mgr.getTasks().find(x => x.id === ev.taskId);
          if (t?.status === 'running') {
            mgr.dispatch(ev.taskId, 'COMPLETE', ev.message || 'Done');
          } else if (ev.message) {
            mgr.appendLog(ev.taskId, ev.message, 'success');
          }
        } else if (ev.action === 'fail') {
          const t = mgr.getTasks().find(x => x.id === ev.taskId);
          if (t?.status === 'running' || t?.status === 'pending') {
            mgr.dispatch(ev.taskId, 'FAIL', ev.message || 'Failed');
          }
        }
      } catch {
        /* invalid transition */
      }
      refresh();
    },
    [refresh],
  );

  const runTaskWithAgent = useCallback(
    async (taskId: string) => {
      const task = taskManagerRef.current.getTasks().find(t => t.id === taskId);
      if (!task) return;
      if (isStreamingRef.current) {
        alert('Please wait for the current chat response to finish before running a task.');
        return;
      }
      try {
        if (task.status === 'pending' || task.status === 'failed') {
          if (task.status === 'failed') {
            taskManagerRef.current.dispatch(taskId, 'RETRY');
          }
          taskManagerRef.current.dispatch(taskId, 'START');
        }
        taskManagerRef.current.appendLog(taskId, 'Dispatching to AI agent…', 'info');
        refresh();
      } catch {
        return;
      }

      if (!backendAvailableRef.current || !backendClient.isConnected()) {
        taskManagerRef.current.dispatch(
          taskId,
          'FAIL',
          'Backend not available. Start with npm run dev:all',
        );
        refresh();
        return;
      }

      const sessionId = opts?.ensureSession ? await opts.ensureSession() : null;

      const prompt =
        `You are executing a coding task from the Task Board.\n\n` +
        `**Task:** ${task.title}\n` +
        `**Description:** ${task.description || '(none)'}\n` +
        `**Priority:** ${task.priority}\n\n` +
        `Use tools as needed. When done, summarize the outcome. ` +
        `If file changes are staged for Apply, list those files for the user.`;

      const msgs = [
        { id: uid('msg'), role: 'user' as const, content: prompt, timestamp: Date.now() },
      ];

      let resultText = '';
      const ok = await backendClient.sendMessage(msgs, activeModelId, {
        onContent: text => {
          resultText += text;
        },
        onThinking: () => {},
        onToolEvent: event => {
          if (event.type === 'start') {
            taskManagerRef.current.appendLog(taskId, `🔧 ${event.name}…`, 'info');
          } else if (event.type === 'result') {
            const okResult = event.result?.success;
            taskManagerRef.current.appendLog(
              taskId,
              `${okResult ? '✓' : '✗'} ${event.name}`,
              okResult ? 'success' : 'error',
            );
          }
          refresh();
        },
        onPendingPatch: p => {
          opts?.onPendingPatch?.(p);
          taskManagerRef.current.appendLog(taskId, `📝 Staged ${p.path}`, 'info');
          refresh();
        },
        onTaskEvent: ev => {
          if (ev.taskId === taskId) handleTaskEvent(ev);
        },
        onDone: () => {
          const summary = resultText.trim().slice(0, 2000) || 'Agent finished with no text output.';
          try {
            const t = taskManagerRef.current.getTasks().find(x => x.id === taskId);
            if (t?.status === 'running') {
              taskManagerRef.current.dispatch(taskId, 'COMPLETE', summary);
            }
          } catch {
            /* cancelled */
          }
          refresh();
        },
        onError: message => {
          try {
            taskManagerRef.current.dispatch(taskId, 'FAIL', message);
          } catch {
            /* ignore */
          }
          refresh();
        },
      }, {
        sessionId: sessionId || undefined,
        taskId,
        taskTitle: task.title,
      });

      if (!ok) {
        taskManagerRef.current.dispatch(taskId, 'FAIL', 'Failed to send task to backend');
        refresh();
      }
    },
    [activeModelId, isStreamingRef, backendAvailableRef, opts, handleTaskEvent, refresh],
  );

  const handleTaskAction = useCallback(
    (taskId: string, action: TaskAction, payload?: string) => {
      if (action === 'START') {
        void runTaskWithAgent(taskId);
        return;
      }
      if (action === 'CANCEL') backendClient.abort();
      try {
        taskManagerRef.current.dispatch(taskId, action, payload);
        refresh();
        if (action === 'RETRY') {
          setTimeout(() => void runTaskWithAgent(taskId), 100);
        }
      } catch (err) {
        console.error('Task action failed:', err);
      }
    },
    [runTaskWithAgent, refresh],
  );

  return {
    tasks,
    handleCreateTask,
    handleTaskAction,
    createRunningTask,
    handleTaskEvent,
  };
}
