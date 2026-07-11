import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import { SystemScope } from '../system-scope';
import { User, UserDocument } from '../models/user.schema';

const logger = new Logger('UsersRepository');

@Injectable()
export class UsersRepository extends ScopedRepository<User> {
  constructor(@InjectModel(User.name) model: Model<User>, cls: ClsService) {
    super(model, cls);
  }

  /**
   * Pre-auth login lookup. By definition this scans across all tenants — the
   * tenant isn't known until the account is found (MVP has no per-tenant
   * hostname/subdomain routing; see user.schema.ts). Routed through
   * SystemScope.run, the same audited cross-tenant escape hatch platform-admin
   * actions use (ADR-0001) — this genuinely is a cross-tenant read, not a bug.
   */
  async findByEmailForAuth(email: string): Promise<UserDocument | null> {
    return SystemScope.run(
      this.cls,
      async (event) => logger.log(`login lookup: ${JSON.stringify(event)}`),
      'login: resolve account by email',
      () => this.model.findOne({ email: email.toLowerCase().trim() }) as Promise<UserDocument | null>,
    );
  }
}
