import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Group, GroupDocument, GroupMemberRole } from '../models/group.schema';

@Injectable()
export class GroupsRepository extends ScopedRepository<Group> {
  constructor(@InjectModel(Group.name) model: Model<Group>, cls: ClsService) {
    super(model, cls);
  }

  findAllForTenant(): Promise<GroupDocument[]> {
    return this.find({}) as unknown as Promise<GroupDocument[]>;
  }

  /** Groups a user belongs to — the principal-set input to ADR-0005's resolver. */
  findForMember(userId: Types.ObjectId): Promise<GroupDocument[]> {
    return this.find({ 'members.userId': userId }) as unknown as Promise<GroupDocument[]>;
  }

  createGroup(name: string): Promise<GroupDocument> {
    return this.create({ name, members: [] }) as unknown as Promise<GroupDocument>;
  }

  /**
   * Name-uniqueness check, tenant-scoped like every other read here. Case-insensitive (2026-08-29
   * fix — "Sales" and "sales" used to be treated as distinct names, so a caller could create a
   * duplicate group differing only in case): a MongoDB collation with strength 2 ignores case (and
   * accents) in the equality comparison itself, so this stays a single indexable query rather than
   * a regex — no user-controlled regex metacharacters to escape either.
   */
  findOneByName(name: string): Promise<GroupDocument | null> {
    return this.model.findOne({ name, ...this.scope() }).collation({ locale: 'en', strength: 2 }) as unknown as Promise<GroupDocument | null>;
  }

  async rename(id: Types.ObjectId, name: string): Promise<GroupDocument | null> {
    await this.updateOne({ _id: id }, { $set: { name } });
    return this.findById(id) as unknown as Promise<GroupDocument | null>;
  }

  /**
   * Add a member or change an existing member's role. `$addToSet`/a whole-array `$set` both fail
   * here: `$addToSet` treats `{userId, role: 'viewer'}` and `{userId, role: 'editor'}` as distinct
   * values (so a role change would append a second row for the same user instead of updating it),
   * and a read-modify-write `$set` of the whole array would clobber a concurrent membership edit.
   * $pull-then-$push is idempotent and race-safe for both "add" and "change role" — a rename to the
   * same role is a harmless no-op, and it is impossible to end up with two rows for one user.
   */
  async setMember(id: Types.ObjectId, userId: Types.ObjectId, role: GroupMemberRole): Promise<GroupDocument | null> {
    await this.updateOne({ _id: id }, { $pull: { members: { userId } } });
    await this.updateOne({ _id: id }, { $push: { members: { userId, role } } });
    return this.findById(id) as unknown as Promise<GroupDocument | null>;
  }

  async removeMembers(id: Types.ObjectId, userIds: Types.ObjectId[]): Promise<GroupDocument | null> {
    await this.updateOne({ _id: id }, { $pull: { members: { userId: { $in: userIds } } } });
    return this.findById(id) as unknown as Promise<GroupDocument | null>;
  }
}
