import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { DeletionVerification, DeletionVerificationDocument } from '../models/deletion-verification.schema';

@Injectable()
export class DeletionVerificationsRepository extends ScopedRepository<DeletionVerification> {
  constructor(@InjectModel(DeletionVerification.name) model: Model<DeletionVerification>, cls: ClsService) {
    super(model, cls);
  }

  record(entry: {
    recycleBinEntryId: Types.ObjectId;
    objectKeysChecked: string[];
    objectKeysStillPresent: string[];
    passed: boolean;
    notes?: string[];
  }): Promise<DeletionVerificationDocument> {
    return this.create({ ...entry, notes: entry.notes ?? [] }) as unknown as Promise<DeletionVerificationDocument>;
  }

  findByRecycleBinEntry(recycleBinEntryId: Types.ObjectId): Promise<DeletionVerificationDocument[]> {
    return this.find({ recycleBinEntryId }) as unknown as Promise<DeletionVerificationDocument[]>;
  }
}
