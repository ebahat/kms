import * as mongoose from 'mongoose';
import { Types } from 'mongoose';
import { Event, EventSchema } from './event.schema';

const EventModel = mongoose.model<Event>('EventSpec', EventSchema);

describe('Event schema', () => {
  it('rejects a save missing groupId', async () => {
    const doc = new EventModel({ tenantId: new Types.ObjectId(), title: 'x', startAt: new Date(), endAt: new Date() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing tenantId', async () => {
    const doc = new EventModel({ groupId: new Types.ObjectId(), title: 'x', startAt: new Date(), endAt: new Date(), createdBy: new Types.ObjectId() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing title', async () => {
    const doc = new EventModel({ tenantId: new Types.ObjectId(), groupId: new Types.ObjectId(), startAt: new Date(), endAt: new Date(), createdBy: new Types.ObjectId() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing startAt/endAt', async () => {
    const doc = new EventModel({ tenantId: new Types.ObjectId(), groupId: new Types.ObjectId(), title: 'x', createdBy: new Types.ObjectId() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('rejects a save missing createdBy', async () => {
    const doc = new EventModel({ tenantId: new Types.ObjectId(), groupId: new Types.ObjectId(), title: 'x', startAt: new Date(), endAt: new Date() });
    await expect(doc.validate()).rejects.toThrow();
  });

  it('accepts a fully-populated event', async () => {
    const doc = new EventModel({
      tenantId: new Types.ObjectId(),
      groupId: new Types.ObjectId(),
      title: 'Team sync',
      description: 'Weekly sync',
      startAt: new Date(),
      endAt: new Date(),
      location: 'Room 1',
      createdBy: new Types.ObjectId(),
    });
    await expect(doc.validate()).resolves.toBeUndefined();
  });
});
