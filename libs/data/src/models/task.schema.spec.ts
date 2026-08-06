import * as mongoose from 'mongoose';
import { Types } from 'mongoose';
import { Task, TaskSchema } from './task.schema';

const TaskModel = mongoose.model<Task>('TaskSpec', TaskSchema);

describe('Task schema', () => {
  it('rejects a save missing groupId', async () => {
    const doc = new TaskModel({ tenantId: new Types.ObjectId(), title: 'x', createdBy: new Types.ObjectId() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing tenantId', async () => {
    const doc = new TaskModel({ groupId: new Types.ObjectId(), title: 'x', createdBy: new Types.ObjectId() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing title', async () => {
    const doc = new TaskModel({ tenantId: new Types.ObjectId(), groupId: new Types.ObjectId(), createdBy: new Types.ObjectId() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing createdBy', async () => {
    const doc = new TaskModel({ tenantId: new Types.ObjectId(), groupId: new Types.ObjectId(), title: 'x' });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a column outside the fixed enum', async () => {
    const doc = new TaskModel({
      tenantId: new Types.ObjectId(),
      groupId: new Types.ObjectId(),
      title: 'x',
      createdBy: new Types.ObjectId(),
      column: 'blocked',
    });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('defaults column to todo', async () => {
    const doc = new TaskModel({
      tenantId: new Types.ObjectId(),
      groupId: new Types.ObjectId(),
      title: 'x',
      createdBy: new Types.ObjectId(),
    });
    await doc.validate();
    expect(doc.column).toBe('todo');
  });

  it('accepts a fully-populated task', async () => {
    const doc = new TaskModel({
      tenantId: new Types.ObjectId(),
      groupId: new Types.ObjectId(),
      title: 'Write report',
      description: 'Quarterly report',
      column: 'in_progress',
      assigneeUserId: new Types.ObjectId(),
      dueDate: new Date(),
      createdBy: new Types.ObjectId(),
    });
    await expect(doc.validate()).resolves.toBeUndefined();
  });
});
