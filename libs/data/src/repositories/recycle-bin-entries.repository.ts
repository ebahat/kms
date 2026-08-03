import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { RecycleBinEntry, RecycleBinEntryDocument, RecycledVersionSnapshot } from '../models/recycle-bin-entry.schema';

@Injectable()
export class RecycleBinEntriesRepository extends ScopedRepository<RecycleBinEntry> {
  constructor(@InjectModel(RecycleBinEntry.name) model: Model<RecycleBinEntry>, cls: ClsService) {
    super(model, cls);
  }

  /** Pending entries only, most tenant-admin-facing screens want just these (UI spec C4). */
  findPending(): Promise<RecycleBinEntryDocument[]> {
    return this.find({ status: 'pending' }) as unknown as Promise<RecycleBinEntryDocument[]>;
  }

  createEntry(entry: {
    documentId: Types.ObjectId;
    folderId: Types.ObjectId;
    name: string;
    versions: RecycledVersionSnapshot[];
    deletedBy: Types.ObjectId;
    purgeAfter: Date;
  }): Promise<RecycleBinEntryDocument> {
    return this.create({ ...entry, status: 'pending' }) as unknown as Promise<RecycleBinEntryDocument>;
  }

  async markRestored(id: Types.ObjectId): Promise<void> {
    await this.updateOne({ _id: id }, { $set: { status: 'restored' } });
  }

  async markPurged(id: Types.ObjectId): Promise<void> {
    await this.updateOne({ _id: id }, { $set: { status: 'purged' } });
  }
}
