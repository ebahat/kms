import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Folder, FolderDocument, MAX_FOLDER_DEPTH, MAX_FOLDERS_PER_TENANT } from '../models/folder.schema';
import { FolderDepthExceededError, FolderLimitExceededError } from '../errors';

@Injectable()
export class FoldersRepository extends ScopedRepository<Folder> {
  constructor(@InjectModel(Folder.name) model: Model<Folder>, cls: ClsService) {
    super(model, cls);
  }

  /** All folders in the caller's tenant — the input ADR-0005's resolution algorithm needs. */
  findAllForTenant(): Promise<FolderDocument[]> {
    return this.find({}) as unknown as Promise<FolderDocument[]>;
  }

  findChildren(parentId: Types.ObjectId | null): Promise<FolderDocument[]> {
    return this.find({ parentId }) as unknown as Promise<FolderDocument[]>;
  }

  /** Enforces the depth bound (PRD §8) and the per-tenant cardinality bound (ADR-0005) before insert. */
  async createFolder(doc: { name: string; parentId: Types.ObjectId | null }): Promise<FolderDocument> {
    const count = await this.model.countDocuments({ ...this.scope() });
    if (count >= MAX_FOLDERS_PER_TENANT) throw new FolderLimitExceededError(MAX_FOLDERS_PER_TENANT);

    let path: Types.ObjectId[] = [];
    if (doc.parentId) {
      const parent = await this.findById(doc.parentId);
      path = parent ? [...parent.path, parent._id] : [];
    }
    if (path.length >= MAX_FOLDER_DEPTH) throw new FolderDepthExceededError(MAX_FOLDER_DEPTH);

    return this.create({ name: doc.name, parentId: doc.parentId, path, grants: [], hasExplicitGrants: false, isPublic: false }) as unknown as Promise<FolderDocument>;
  }
}
