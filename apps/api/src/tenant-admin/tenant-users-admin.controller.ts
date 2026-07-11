import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { randomBytes } from 'crypto';
import { Edition, CreateUserRequestSchema, CsvImportRowSchema, ImportUsersRequestSchema, CsvImportRowResult, UserSummary } from '@kms/contracts';
import { hashPassword, SessionService } from '@kms/auth';
import { toObjectId, UserDocument, UsersRepository } from '@kms/data';
import { AdminOnlyGuard } from '../common/admin-only.guard';
import { SESSION_SERVICE } from '../auth/session-auth.guard';
import { PASSWORD_PEPPER } from '../auth/auth.providers';

/**
 * Tenant-admin user management (PRD §6): create/deactivate/reactivate,
 * CSV bulk import. Every call is implicitly tenant-scoped by UsersRepository
 * (ADR-0001) — an admin can never touch another tenant's users, and an id
 * belonging to another tenant 404s rather than 403s (sec §3.2 convention).
 */
@Controller('tenant-admin/users')
@Edition('both')
@UseGuards(AdminOnlyGuard)
export class TenantUsersAdminController {
  constructor(
    private readonly users: UsersRepository,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(PASSWORD_PEPPER) private readonly pepper: string,
  ) {}

  @Get()
  async list(): Promise<UserSummary[]> {
    const docs = await this.users.find({});
    return docs.map(toSummary);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<{ userId: string; email: string; tempPassword: string }> {
    const { email, role } = CreateUserRequestSchema.parse(body);
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword, this.pepper);

    try {
      const created = await this.users.create({
        email: email.toLowerCase().trim(),
        role,
        passwordHash,
        status: 'active',
        mfaEnabled: false,
        totpBackupCodeHashes: [],
      });
      return { userId: created._id.toString(), email: created.email, tempPassword };
    } catch {
      // email carries a global unique index (login resolves tenant FROM email — see user.schema.ts)
      throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS' });
    }
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  async deactivate(@Param('id') id: string): Promise<{ ok: true }> {
    const objectId = toObjectId(id);
    const user = await this.users.findById(objectId);
    if (!user) throw new NotFoundException();

    await this.users.updateOne({ _id: objectId }, { $set: { status: 'inactive' } });
    await this.sessions.revokeAll('tenant', user._id.toString()); // deactivation immediately revokes all sessions (PRD §6)
    return { ok: true };
  }

  @Patch(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string): Promise<{ ok: true }> {
    const objectId = toObjectId(id);
    const user = await this.users.findById(objectId);
    if (!user) throw new NotFoundException();

    await this.users.updateOne({ _id: objectId }, { $set: { status: 'active' } });
    return { ok: true };
  }

  /**
   * Accepts raw CSV text rather than a multipart file upload — there is no
   * file-upload plumbing (multer) in this API yet, and the web UI (Phase 1.7)
   * is the natural place to read the File and forward its text content.
   */
  @Post('import')
  @HttpCode(200)
  async importCsv(@Body() body: unknown): Promise<{ results: CsvImportRowResult[] }> {
    const { csvContent } = ImportUsersRequestSchema.parse(body);
    const records: Record<string, string>[] = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

    const results: CsvImportRowResult[] = [];
    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 1;
      const raw = records[i];
      const parsed = CsvImportRowSchema.safeParse({ email: raw.email, role: raw.role || undefined });

      if (!parsed.success) {
        results.push({ row: rowNumber, email: raw.email, status: 'error', error: parsed.error.issues[0]?.message ?? 'invalid row' });
        continue;
      }

      try {
        const tempPassword = generateTempPassword();
        const passwordHash = await hashPassword(tempPassword, this.pepper);
        await this.users.create({
          email: parsed.data.email,
          role: parsed.data.role,
          passwordHash,
          status: 'active',
          mfaEnabled: false,
          totpBackupCodeHashes: [],
        });
        results.push({ row: rowNumber, email: parsed.data.email, status: 'created' });
      } catch {
        results.push({ row: rowNumber, email: parsed.data.email, status: 'error', error: 'email already exists' });
      }
    }

    return { results };
  }
}

function toSummary(doc: UserDocument): UserSummary {
  return {
    id: doc._id.toString(),
    email: doc.email,
    role: doc.role,
    status: doc.status,
    mfaEnabled: doc.mfaEnabled,
    lastLoginAt: doc.lastLoginAt,
  };
}

function generateTempPassword(): string {
  return randomBytes(16).toString('base64url'); // well above the 12-char minimum (sec §2)
}
