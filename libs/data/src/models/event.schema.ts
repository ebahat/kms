import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** Calendar events, one calendar per group (Phase 2A design, decision 1). */
@Schema({ collection: 'events', timestamps: true })
export class Event {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  groupId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop({ trim: true })
  location?: string;

  @Prop({ required: true, type: Types.ObjectId })
  createdBy!: Types.ObjectId;
}

export type EventDocument = HydratedDocument<Event> & { _id: Types.ObjectId };
export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index({ tenantId: 1, groupId: 1, startAt: 1 });
EventSchema.plugin(tenantScopeBackstopPlugin);
