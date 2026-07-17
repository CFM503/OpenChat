import { useState, useCallback, useRef } from 'react';
import type { AgentTask, TaskAction } from '../core/types';
import { TaskManager } from '../core/taskStateMachine';
import { backendClient } from '../services/api';
import { uid } from '../lib/uid';

export function useTasks(
  activeModelId: string,
  isStreaming: boolean,
  backendAvailableRef: React.MutableRefObject<boolean>,
) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const taskManagerRef = useRef(new TaskManager());

  const handleCreateTask = useCallback(
    (title: string, description: string, assignee: string, priority: AgentTask['priority']) => {
      const task = taskManagerRef.current.create(title, description, assignee, priority);
      setTasks(taskManagerRef.current.getTasks());
      return task;
    },
    [],
  );

  const runTaskWithAgent = useCallback(
    async (taskId: string) => {
      const task = taskManagerRef.current.getTasks().find(t => t.id === taskId);
      if (!task) return;
      if (isStreaming) {
        alert('Please wait for the current chat response to finish before running a task.');
        return;
      }
      try {
        taskManagerRef.current.dispatch(taskId, 'START');
        taskManagerRef.current.appendLog(taskId, 'Dispatching to AI agent…', 'info');
        setTasks(taskManagerRef.current.getTasks());
      } catch {
        return;
      }

      if (!backendAvailableRef.current || !backendClient.isConnected()) {
        taskManagerRef.current.dispatch(
          taskId,
          'FAIL',
          'Backend not available. Start with npm run dev:all',
        );
        setTasks(taskManagerRef.current.getTasks());
        return;
      }

      const prompt =
        `You are executing a coding task from the Task Board.\n\n` +
        `**Task:** ${task.title}\n` +
        `**Description:** ${task.description || '(none)'}\n` +
        `**Priority:** ${task.priority}\n\n` +
        `Use tools as needed. When done, summarize the outcome.`;

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
          setTasks(taskManagerRef.current.getTasks());
        },
        onDone: () => {
          const summary = resultText.trim().slice(0, 2000) || 'Agent finished with no text output.';
          try {
            taskManagerRef.current.dispatch(taskId, 'COMPLETE', summary);
          } catch { /* cancelled */ }
          setTasks(taskManagerRef.current.getTasks());
        },
        onError: message => {
          try {
            taskManagerRef.current.dispatch(taskId, 'FAIL', message);
          } catch { /* ignore */ }
          setTasks(taskManagerRef.current.getTasks());
        },
      });

      if (!ok) {
        taskManagerRef.current.dispatch(taskId, 'FAIL', 'Failed to send task to backend');
        setTasks(taskManagerRef.current.getTasks());
      }
    },
    [activeModelId, isStreaming, backendAvailableRef],
  );

  const handleTaskAction = useCallback(
    (taskId: string, action: TaskAction, payload?: string) => {
      if (action === 'START') {
        runTaskWithAgent(taskId);
        return;
      }
      if (action === 'CANCEL') backendClient.abort();
      try {
        taskManagerRef.current.dispatch(taskId, action, payload);
        setTasks(taskManagerRef.current.getTasks());
        if (action === 'RETRY') {
          setTimeout(() => runTaskWithAgent(taskId), 100);
        }
      } catch (err) {
        console.error('Task action failed:', err);
      }
    },
    [runTaskWithAgent],
  );

  return { tasks, handleCreateTask, handleTaskAction };
}
