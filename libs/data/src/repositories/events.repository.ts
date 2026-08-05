import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Event, EventDocument } from '../models/event.schema';

@Injectable()
export class EventsRepository extends ScopedRepository<Event> {
  constructor(@InjectModel(Event.name) model: Model<Event>, cls: ClsService) {
    super(model, cls);
  }

  findForGroup(groupId: Types.ObjectId): Promise<EventDocument[]> {
    return this.find({ groupId }) as unknown as Promise<EventDocument[]>;
  }

  /** Used by Task 5's merged calendar-read route. */
  findForGroupInRange(groupId: Types.ObjectId, from: Date, to: Date): Promise<EventDocument[]> {
    return this.find({ groupId, startAt: { $lte: to }, endAt: { $gte: from } }) as unknown as Promise<EventDocument[]>;
  }
}
