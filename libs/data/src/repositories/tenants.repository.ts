import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import { Tenant, TenantDocument } from '../models/tenant.schema';

/**
 * Deliberately NOT a ScopedRepository subclass — the tenants collection is
 * the tenant registry itself (ADR-0002), it has no tenantId to scope by.
 * Managed only from the platform-admin realm (PRD §5); the repository does
 * not enforce that boundary itself (there's nothing to scope), the caller
 * (apps/portal-api) is the enforcement point.
 */
@Injectable()
export class TenantsRepository {
  constructor(@InjectModel(Tenant.name) private readonly model: Model<Tenant>) {}

  find(filter: FilterQuery<Tenant> = {}) {
    return this.model.find(filter);
  }

  findById(id: Types.ObjectId) {
    return this.model.findOne({ _id: id }) as Promise<TenantDocument | null>;
  }

  /** Phase C — subdomain routing/uniqueness lookups (C1.2 provisioning, C2.4 hostname resolution). */
  findBySubdomain(subdomain: string) {
    return this.model.findOne({ subdomain }) as Promise<TenantDocument | null>;
  }

  create(doc: Omit<Tenant, 'status'> & { status?: Tenant['status'] }) {
    return this.model.create(doc);
  }

  updateOne(id: Types.ObjectId, update: UpdateQuery<Tenant>) {
    return this.model.updateOne({ _id: id }, update);
  }

  /** Tenant lifecycle: suspend/reactivate (PRD §5). */
  setStatus(id: Types.ObjectId, status: Tenant['status']) {
    return this.model.updateOne({ _id: id }, { $set: { status } });
  }

  /** Compensating-delete for provisioning rollback (Phase C, C1.2) — a tenant must never be left without its admin. */
  deleteById(id: Types.ObjectId) {
    return this.model.deleteOne({ _id: id });
  }
}
