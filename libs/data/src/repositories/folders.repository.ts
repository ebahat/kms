import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Folder, FolderDocument, MAX_FOLDER_DEPTH, MAX_FOLDERS_PER_TENANT } from '../models/folder.schema';
import { FolderCycleError, FolderDepthExceededError, FolderLimitExceededError, FolderParentNotFoundError } from '../errors';

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
      // Tenant-scoped lookup (ScopedRepository.findById) — this also rejects a parentId belonging
      // to another tenant, not just a nonexistent one. A dangling parentId must never be stored:
      // it breaks ADR-0005's resolver for the whole tenant, not just this folder (Phase 2 plan Task 1).
      const parent = await this.findById(doc.parentId);
      if (!parent) throw new FolderParentNotFoundError();
      path = [...parent.path, parent._id];
    }
    if (path.length >= MAX_FOLDER_DEPTH) throw new FolderDepthExceededError(MAX_FOLDER_DEPTH);

    return this.create({ name: doc.name, parentId: doc.parentId, path, grants: [], hasExplicitGrants: false, isPublic: false }) as unknown as Promise<FolderDocument>;
  }

  async renameFolder(id: Types.ObjectId, name: string): Promise<FolderDocument | null> {
    await this.updateOne({ _id: id }, { $set: { name } });
    return this.findById(id) as unknown as Promise<FolderDocument | null>;
  }

  /**
   * Re-parents a folder and rewrites `path` for it and every descendant (a
   * move is not a single-document update — every folder under the moved one
   * has this folder's id baked into its own `path` array). Rejects a cycle
   * (moving into the folder's own subtree, including itself) and a depth
   * bound violation computed across the *whole* subtree being moved, not
   * just the folder itself — a shallow folder with deep descendants can
   * still bust the bound even though the folder's own new depth looks fine.
   */
  async moveFolder(id: Types.ObjectId, newParentId: Types.ObjectId | null): Promise<FolderDocument> {
    const folder = await this.findById(id);
    if (!folder) throw new FolderParentNotFoundError(); // caller-facing: "the folder being moved doesn't exist" reuses the same 404 shape

    let newPath: Types.ObjectId[] = [];
    if (newParentId) {
      if (newParentId.equals(id)) throw new FolderCycleError();
      const newParent = await this.findById(newParentId);
      if (!newParent) throw new FolderParentNotFoundError();
      if (newParent.path.some((ancestorId) => ancestorId.equals(id))) throw new FolderCycleError();
      newPath = [...newParent.path, newParent._id];
    }

    const descendants = (await this.find({ path: id })) as unknown as FolderDocument[];

    const maxOldPathLength = Math.max(folder.path.length, ...descendants.map((d) => d.path.length));
    const depthDelta = newPath.length - folder.path.length;
    if (maxOldPathLength + depthDelta >= MAX_FOLDER_DEPTH) throw new FolderDepthExceededError(MAX_FOLDER_DEPTH);

    await this.updateOne({ _id: id }, { $set: { parentId: newParentId, path: newPath } });

    for (const descendant of descendants) {
      const ownIndex = descendant.path.findIndex((ancestorId) => ancestorId.equals(id));
      const rebuiltPath = [...newPath, id, ...descendant.path.slice(ownIndex + 1)];
      await this.updateOne({ _id: descendant._id }, { $set: { path: rebuiltPath } });
    }

    return (await this.findById(id)) as unknown as FolderDocument;
  }
}
