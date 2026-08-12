import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

export const TASK_COLUMNS = ['todo', 'in_progress', 'done'] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

/** Kanban tasks, one board per group, fixed 3 columns (Phase 2A design, decision 4). */
@Schema({ collection: 'tasks', timestamps: true })
export class Task {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  groupId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, enum: ['todo', 'in_progress', 'done'], default: 'todo' })
  column!: TaskColumn;

  @Prop({ type: Types.ObjectId })
  assigneeUserId?: Types.ObjectId;

  @Prop()
  dueDate?: Date;

  @Prop({ required: true, type: Types.ObjectId })
  createdBy!: Types.ObjectId;
}

export type TaskDocument = HydratedDocument<Task> & { _id: Types.ObjectId };
export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.index({ tenantId: 1, groupId: 1, column: 1 });
TaskSchema.plugin(tenantScopeBackstopPlugin);
