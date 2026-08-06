import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Task, TaskDocument } from '../models/task.schema';

@Injectable()
export class TasksRepository extends ScopedRepository<Task> {
  constructor(@InjectModel(Task.name) model: Model<Task>, cls: ClsService) {
    super(model, cls);
  }

  findForGroup(groupId: Types.ObjectId): Promise<TaskDocument[]> {
    return this.find({ groupId }) as unknown as Promise<TaskDocument[]>;
  }

  /** Used by CalendarController's merged read (design doc: "task due dates surface on the calendar"). */
  findWithDueDateInRange(groupId: Types.ObjectId, from: Date, to: Date): Promise<TaskDocument[]> {
    return this.find({ groupId, dueDate: { $gte: from, $lte: to } }) as unknown as Promise<TaskDocument[]>;
  }
}
