import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { AuditEvent, AuditEventDocument } from '../models/audit-event.schema';
import { MissingScopeError } from '../errors';
import { SCOPE_CLS_KEY, Scope } from '../scope';

/**
 * Append-only by construction (ADR-0002 sec §8.1): this class exposes only
 * `record` and read methods — no update/delete method exists to call. Do
 * not add one.
 */
@Injectable()
export class AuditEventsRepository extends ScopedRepository<AuditEvent> {
  constructor(@InjectModel(AuditEvent.name) model: Model<AuditEvent>, cls: ClsService) {
    super(model, cls);
  }

  /** actorUserId is always the current scope's user — audit events are never recorded on someone else's behalf. */
  async record(entry: { action: string; targetId?: Types.ObjectId; metadata?: Record<string, unknown> }): Promise<AuditEventDocument> {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!scope) throw new MissingScopeError('AuditEvent');

    return this.create({
      actorUserId: scope.userId,
      action: entry.action,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    }) as unknown as Promise<AuditEventDocument>;
  }

  findByTarget(targetId: Types.ObjectId): Promise<AuditEventDocument[]> {
    return this.find({ targetId }) as unknown as Promise<AuditEventDocument[]>;
  }
}
