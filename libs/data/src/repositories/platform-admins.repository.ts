import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import { PlatformAdmin, PlatformAdminDocument } from '../models/platform-admin.schema';

/**
 * Plain (non-scoped) repository, like TenantsRepository — the platform-admin
 * realm has no tenant concept at all. Import-restricted to apps/portal-api
 * by convention (nothing in the tenant realm should ever reference this).
 */
@Injectable()
export class PlatformAdminsRepository {
  constructor(@InjectModel(PlatformAdmin.name) private readonly model: Model<PlatformAdmin>) {}

  findByEmail(email: string) {
    return this.model.findOne({ email: email.toLowerCase().trim() }) as Promise<PlatformAdminDocument | null>;
  }

  findById(id: Types.ObjectId) {
    return this.model.findOne({ _id: id }) as Promise<PlatformAdminDocument | null>;
  }

  find() {
    return this.model.find({});
  }

  create(doc: Omit<PlatformAdmin, 'status' | 'mfaEnabled'> & { status?: PlatformAdmin['status']; mfaEnabled?: boolean }) {
    return this.model.create(doc);
  }

  updateOne(id: Types.ObjectId, update: UpdateQuery<PlatformAdmin>) {
    return this.model.updateOne({ _id: id }, update);
  }
}
