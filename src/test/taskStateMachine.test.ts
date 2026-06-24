// ============================================================================
// Test Suite C: Agent Task State Machine & Transition Flows
// ============================================================================

import { describe, it, expect } from 'vitest';
import { TaskManager, isValidTransition, getNextStatus } from '../core/taskStateMachine';

describe('Task State Machine', () => {
  it('should create a task in PENDING status', () => {
    const manager = new TaskManager();
    const task = manager.create('Test task', 'Testing details', 'Agent-99', 'high');

    expect(task.status).toBe('pending');
    expect(task.title).toBe('Test task');
    expect(task.assignee).toBe('Agent-99');
    expect(task.priority).toBe('high');
    expect(task.logs.length).toBe(1);
    expect(task.logs[0].message).toContain('created');
  });

  it('should support correct transition flow: Pending -> Running -> Success', () => {
    const manager = new TaskManager();
    const task = manager.create('Run Pipeline', 'Run CI/CD tests', 'CI-Agent');

    // Verify initial transition availability
    expect(isValidTransition(task.status, 'START')).toBe(true);
    expect(isValidTransition(task.status, 'COMPLETE')).toBe(false);

    // Transition to Running
    const runningTask = manager.dispatch(task.id, 'START');
    expect(runningTask.status).toBe('running');
    expect(runningTask.logs.length).toBe(2);
    expect(runningTask.logs[1].message).toBe('Task execution started');

    // Transition to Success
    const successTask = manager.dispatch(task.id, 'COMPLETE', 'All tests completed successfully in 45s.');
    expect(successTask.status).toBe('success');
    expect(successTask.result).toBe('All tests completed successfully in 45s.');
    expect(successTask.logs.length).toBe(3);
    expect(successTask.logs[2].level).toBe('success');
  });

  it('should support transition flow: Pending -> Running -> Failed -> Retry -> Pending', () => {
    const manager = new TaskManager();
    const task = manager.create('Build App', 'Build production bundle', 'Builder-Agent');

    // Start
    manager.dispatch(task.id, 'START');

    // Fail
    const failedTask = manager.dispatch(task.id, 'FAIL', 'Compilation Error: Unexpected token.');
    expect(failedTask.status).toBe('failed');
    expect(failedTask.error).toBe('Compilation Error: Unexpected token.');

    // Retry
    const retriedTask = manager.dispatch(task.id, 'RETRY');
    expect(retriedTask.status).toBe('pending');
    expect(retriedTask.error).toBeUndefined();
    expect(retriedTask.result).toBeUndefined();
    expect(retriedTask.logs.find(l => l.message === 'Task queued for retry')).toBeDefined();
  });

  it('should allow cancellation from Pending or Running states', () => {
    const manager = new TaskManager();
    
    // Test cancel from Pending
    const task1 = manager.create('Task 1', 'Cancel from pending', 'Agent-1');
    expect(isValidTransition(task1.status, 'CANCEL')).toBe(true);
    const cancelled1 = manager.dispatch(task1.id, 'CANCEL');
    expect(cancelled1.status).toBe('failed');
    expect(cancelled1.error).toBe('Cancelled by user');

    // Test cancel from Running
    const task2 = manager.create('Task 2', 'Cancel from running', 'Agent-2');
    manager.dispatch(task2.id, 'START');
    expect(isValidTransition(task2.status, 'CANCEL')).toBe(true);
    const cancelled2 = manager.dispatch(task2.id, 'CANCEL');
    expect(cancelled2.status).toBe('failed');
    expect(cancelled2.error).toBe('Cancelled by user');
  });

  it('should block invalid transitions by throwing error', () => {
    const manager = new TaskManager();
    const task = manager.create('Restricted task', 'Cannot transition directly', 'Strict-Agent');

    // Cannot go directly from pending to success
    expect(isValidTransition(task.status, 'COMPLETE')).toBe(false);
    expect(getNextStatus(task.status, 'COMPLETE')).toBeNull();

    expect(() => {
      manager.dispatch(task.id, 'COMPLETE', 'Done!');
    }).toThrowError('Invalid transition');
  });
});
