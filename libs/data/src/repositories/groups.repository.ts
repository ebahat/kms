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
}
