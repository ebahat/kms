import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { Group, GroupDocument } from '../models/group.schema';

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
    return this.find({ memberUserIds: userId }) as unknown as Promise<GroupDocument[]>;
  }

  createGroup(name: string): Promise<GroupDocument> {
    return this.create({ name, memberUserIds: [] }) as unknown as Promise<GroupDocument>;
  }

  /** $addToSet, not a read-modify-write $set of the whole array — concurrent membership edits must not clobber each other. */
  async addMembers(id: Types.ObjectId, userIds: Types.ObjectId[]): Promise<GroupDocument | null> {
    await this.updateOne({ _id: id }, { $addToSet: { memberUserIds: { $each: userIds } } });
    return this.findById(id) as unknown as Promise<GroupDocument | null>;
  }

  async removeMembers(id: Types.ObjectId, userIds: Types.ObjectId[]): Promise<GroupDocument | null> {
    await this.updateOne({ _id: id }, { $pull: { memberUserIds: { $in: userIds } } });
    return this.findById(id) as unknown as Promise<GroupDocument | null>;
  }
}
