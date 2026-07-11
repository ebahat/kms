import { ClsService } from 'nestjs-cls';
import { DeleteResult } from 'mongodb';
import { FilterQuery, Model, PipelineStage, Types, UpdateQuery } from 'mongoose';
import { Scope, SCOPE_CLS_KEY } from './scope';
import { MissingScopeError } from './errors';

/**
 * The ONLY sanctioned way application code touches tenant-owned data (ADR-0001).
 * Direct model injection outside libs/data is banned by lint
 * (eslint-rules/no-restricted-imports) and detected at runtime by the
 * backstop plugin (backstop.plugin.ts) if lint is ever bypassed.
 */
export abstract class ScopedRepository<T> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly cls: ClsService,
  ) {}

  /** Throws MissingScopeError if no authenticated scope — fail closed. */
  protected scope(): FilterQuery<T> {
    const s = this.cls.get<Scope>(SCOPE_CLS_KEY);
    if (!s?.tenantId) throw new MissingScopeError(this.model.modelName);
    return this.buildFilter(s);
  }

  /** Tenant-scoped by default; OwnerScopedRepository overrides. */
  protected buildFilter(s: Scope): FilterQuery<T> {
    return { tenantId: s.tenantId } as FilterQuery<T>;
  }

  find(filter: FilterQuery<T> = {}) {
    return this.model.find({ ...filter, ...this.scope() });
  }

  /** A miss returns null, which callers map to 404 — never 403 (sec §3.2). */
  findById(id: Types.ObjectId) {
    return this.model.findOne({ _id: id, ...this.scope() } as FilterQuery<T>);
  }

  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>) {
    return this.model.updateOne({ ...filter, ...this.scope() }, update);
  }

  deleteOne(filter: FilterQuery<T>): Promise<DeleteResult> {
    return this.model.deleteOne({ ...filter, ...this.scope() });
  }

  /** Scope is prepended as the FIRST pipeline stage, always. */
  aggregate<R = T>(pipeline: PipelineStage[]) {
    return this.model.aggregate<R>([{ $match: this.scope() }, ...pipeline]);
  }

  /** Stamps tenantId (and ownerUserId, for OwnerScopedRepository) from scope,
   *  ignoring any tenantId present in the DTO (sec §3.1, §4.1). */
  create(doc: Omit<T, 'tenantId'>) {
    return this.model.create({ ...doc, ...this.scope() } as T);
  }
}

/**
 * Smart-OCR per-user directory isolation AND private chat history (sec §3.5, §3.6).
 * The only access path to record classes whose confidentiality boundary is
 * the USER, not the tenant: ocrFiles, conversations, messages.
 */
export abstract class OwnerScopedRepository<T> extends ScopedRepository<T> {
  protected override buildFilter(s: Scope): FilterQuery<T> {
    if (!s.ownerUserId) throw new MissingScopeError(this.model.modelName);
    return { tenantId: s.tenantId, ownerUserId: s.ownerUserId } as FilterQuery<T>;
  }
}
