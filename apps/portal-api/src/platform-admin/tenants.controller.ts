import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHash } from 'crypto';
import { ClsService } from 'nestjs-cls';
import {
  CheckSubdomainQuerySchema,
  CheckSubdomainResponse,
  CreateTenantRequestSchema,
  ProvisionTenantRequestSchema,
  ProvisionTenantResponse,
  ResetTenantAdminPasswordResponse,
  TenantAdminSummary,
  UpdateTenantQuotaRequestSchema,
  UpdateTenantRequestSchema,
} from '@kms/contracts';
import { generateTempPassword, hashPassword, SessionService } from '@kms/auth';
import { buildTenantLogoObjectKey, inferTenantLogoContentType, MIME_TYPES, sniffFileType } from '@kms/storage';
import { newObjectId, SCOPE_CLS_KEY, SystemScope, toObjectId, Tenant, TenantsRepository, UserDocument, UsersRepository } from '@kms/data';
import { PASSWORD_PEPPER } from '../auth/auth.providers';
import { SESSION_SERVICE } from '../auth/platform-session-auth.guard';
import { MulterExceptionFilter } from './tenant-logo-multer-exception.filter';
import { STORAGE_PROVIDER, StorageProvider } from './tenant-storage.providers';
import { ZodExceptionFilter } from './zod-exception.filter';

const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB — a logo, not a document (C1.3)

/** Local alias so this file never imports `mongoose` itself (ADR-0001 confines that to libs/data). */
type ObjectId = ReturnType<typeof newObjectId>;

/** getOne()/update() add a preview URL for the superuser edit screen — Tenant itself never stores it (only the object key). */
type TenantWithLogoUrl = Tenant & { logoUrl?: string };

/**
 * Tenant lifecycle (PRD §5): create/configure/suspend/reactivate, set quotas. Lives under
 * platform-admin/** so SystemScope is importable here (ADR-0001 lint restriction) — every call is
 * an audited cross-tenant action by nature.
 *
 * Phase C (2026-08-22) added atomic tenant+first-admin provisioning, subdomain-availability
 * checking, and logo upload — the superuser screen's backend
 * (docs/plans/superuser-subdomain-provisioning-22-08-2026-plan.md, C1 only; C2's real subdomain
 * routing is separately-gated production infra work, not part of this controller).
 */
@Controller('platform-admin/tenants')
@UseFilters(ZodExceptionFilter)
export class PlatformTenantsController {
  private readonly logger = new Logger('PlatformAudit');

  constructor(
    private readonly tenants: TenantsRepository,
    private readonly users: UsersRepository,
    private readonly cls: ClsService,
    @Inject(PASSWORD_PEPPER) private readonly pepper: string,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(): Promise<Tenant[]> {
    return SystemScope.run(this.cls, this.auditWrite, 'platform-admin: list tenants', () => this.tenants.find());
  }

  /**
   * Debounced availability check for the superuser form (C1.5) — same UX principle as any
   * signup-flow username check. Reserved-word rejection happens here too (not just on submit) so
   * the UI can surface it immediately, before the applicant tries to submit the whole form.
   */
  @Get('check-subdomain')
  async checkSubdomain(@Query() query: unknown): Promise<CheckSubdomainResponse> {
    const { value } = CheckSubdomainQuerySchema.parse(query);
    const parsed = ProvisionTenantRequestSchema.shape.subdomain.safeParse(value);
    if (!parsed.success) return { available: false };

    const existing = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: check subdomain "${value}"`, () =>
      this.tenants.findBySubdomain(parsed.data),
    );
    return { available: !existing };
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<TenantWithLogoUrl> {
    const tenant = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: view tenant ${id}`, () =>
      this.tenants.findById(toObjectId(id)),
    );
    if (!tenant) throw new NotFoundException();
    return this.withLogoUrl(tenant);
  }

  /**
   * Signed preview URL for the superuser edit screen — same fail-soft convention as
   * AuthController.getSession() (apps/api): a signing hiccup degrades to no preview, never breaks
   * the whole response, since this is cosmetic.
   */
  private async withLogoUrl(tenant: Tenant): Promise<TenantWithLogoUrl> {
    if (!tenant.logoObjectKey) return tenant;
    try {
      const signed = await this.storage.getSignedDownloadUrl(tenant.logoObjectKey, {
        displayFilename: 'logo',
        inline: true,
        contentType: inferTenantLogoContentType(tenant.logoObjectKey),
      });
      // Plain-object spread, not a mutation of `tenant` in place: a real Mongoose document's
      // default JSON serialization only reliably includes schema-defined paths, so an ad-hoc
      // property assigned directly onto the document instance isn't guaranteed to survive
      // res.json()'s serialization the way a plain object's would.
      const withToObject = tenant as Tenant & { toObject?: () => Tenant };
      const plain = typeof withToObject.toObject === 'function' ? withToObject.toObject() : tenant;
      return { ...plain, logoUrl: signed.url };
    } catch {
      return tenant;
    }
  }

  /** Legacy tenant-only create (no admin) — kept for any caller that isn't the superuser screen. */
  @Post()
  async create(@Body() body: unknown): Promise<Tenant> {
    const dto = CreateTenantRequestSchema.parse(body);
    return SystemScope.run(this.cls, this.auditWrite, `platform-admin: create tenant "${dto.name}"`, () =>
      this.tenants.create({
        name: dto.name,
        edition: dto.edition,
        storageQuotaBytes: dto.storageQuotaBytes ?? 1_073_741_824,
        featureToggles: [],
      }),
    );
  }

  /**
   * Atomic tenant + first-admin provisioning (Phase C, C1.2) — the superuser screen's single
   * submit. A tenant with no admin at all is a useless, half-finished state, so this always
   * creates both together.
   *
   * Not wrapped in a real Mongo multi-document transaction: Atlas M0 does support them, but this
   * codebase's shared integration-test harness (apps/api/test/support/test-app.ts,
   * mongodb-memory-server) boots a standalone instance, not a replica set, and standalone mongod
   * cannot run transactions at all — reconfiguring that shared harness (used by many other specs)
   * to replica-set mode was judged riskier than the alternative here. Instead: create the tenant,
   * then create the admin, and if admin-creation fails, compensate by deleting the tenant. This
   * keeps behavior identical between tests and production (same code path either way) rather than
   * having tests exercise a different mechanism than what actually runs against Atlas.
   */
  @Post('provision')
  @HttpCode(201)
  async provision(@Body() body: unknown): Promise<ProvisionTenantResponse> {
    const dto = ProvisionTenantRequestSchema.parse(body);

    const existing = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: check subdomain "${dto.subdomain}"`, () =>
      this.tenants.findBySubdomain(dto.subdomain),
    );
    if (existing) throw new ConflictException({ error: 'SUBDOMAIN_TAKEN' });

    const tenant = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: provision tenant "${dto.name}" (${dto.subdomain})`, () =>
      this.tenants.create({
        name: dto.name,
        edition: dto.edition,
        subdomain: dto.subdomain,
        themeColorRgb: dto.themeColorRgb,
        storageQuotaBytes: dto.storageQuotaBytes ?? 1_073_741_824,
        featureToggles: [],
      }),
    );

    // tempPassword/passwordHash generation is pure CPU-bound crypto (no I/O, can't fail on
    // "email already exists") — kept outside the try block so the catch below only ever
    // attributes a real users.create() failure to that specific, accurate cause.
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword, this.pepper);
    const placeholderId = newObjectId(); // scope.userId is unused by ScopedRepository.create()'s buildFilter — same trick as bootstrap/seed.ts

    try {
      // `await` inside the callback (not `return this.users.create(...)` bare) — see
      // runAsTenant()'s doc comment below for why: a query/write only reliably sees the scope
      // this sets if its actual execution happens within cls.run()'s own tracked continuation.
      const admin = await this.cls.run(async () => {
        this.cls.set(SCOPE_CLS_KEY, { tenantId: tenant._id, userId: placeholderId, role: 'admin' as const, edition: tenant.edition });
        return await this.users.create({
          email: dto.adminEmail.toLowerCase().trim(),
          role: 'admin',
          passwordHash,
          status: 'active',
          mfaEnabled: false,
          totpBackupCodeHashes: [],
        });
      });

      return {
        tenantId: tenant._id.toString(),
        subdomain: dto.subdomain,
        adminUserId: admin._id.toString(),
        adminEmail: admin.email,
        tempPassword,
      };
    } catch {
      await this.tenants.deleteById(tenant._id);
      // email carries a global unique index (login resolves tenant FROM email — see user.schema.ts)
      throw new ConflictException({ error: 'ADMIN_EMAIL_ALREADY_EXISTS' });
    }
  }

  /**
   * Edit an existing tenant (Phase C follow-up, 2026-08-22) — every field optional, only what's
   * present is changed. Subdomain is still just stored metadata until C2 (real routing) exists,
   * but is validated exactly like at provisioning time so it can't drift into an invalid or
   * reserved value via this path either.
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<TenantWithLogoUrl> {
    const tenantId = toObjectId(id);
    const dto = UpdateTenantRequestSchema.parse(body);

    const existing = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: view tenant ${id}`, () => this.tenants.findById(tenantId));
    if (!existing) throw new NotFoundException();

    if (dto.subdomain !== undefined) {
      const conflict = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: check subdomain "${dto.subdomain}"`, () =>
        this.tenants.findBySubdomain(dto.subdomain!),
      );
      if (conflict && !conflict._id.equals(tenantId)) throw new ConflictException({ error: 'SUBDOMAIN_TAKEN' });
    }

    const $set: Partial<Pick<Tenant, 'name' | 'edition' | 'subdomain' | 'themeColorRgb'>> = {};
    if (dto.name !== undefined) $set.name = dto.name;
    if (dto.edition !== undefined) $set.edition = dto.edition;
    if (dto.subdomain !== undefined) $set.subdomain = dto.subdomain;
    if (dto.themeColorRgb !== undefined) $set.themeColorRgb = dto.themeColorRgb;

    const updated = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: update tenant ${id}`, async () => {
      await this.tenants.updateOne(tenantId, { $set });
      return this.tenants.findById(tenantId);
    });
    if (!updated) throw new NotFoundException();
    return this.withLogoUrl(updated);
  }

  /** Admin-role users for a tenant (Phase C follow-up) — the superuser screen's "reset password" target list. */
  @Get(':id/admins')
  async listAdmins(@Param('id') id: string): Promise<TenantAdminSummary[]> {
    const tenantId = toObjectId(id);
    const tenant = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: view tenant ${id}`, () => this.tenants.findById(tenantId));
    if (!tenant) throw new NotFoundException();

    const admins = await this.runAsTenant(tenantId, tenant.edition, `platform-admin: list admins for tenant ${id}`, () => this.users.find({ role: 'admin' }));
    return admins.map((u: UserDocument) => ({ id: u._id.toString(), email: u.email, status: u.status }));
  }

  /**
   * Reset a tenant admin's password (Phase C follow-up) — the superuser's only way to unblock a
   * locked-out tenant admin, since there's no cross-realm email-delivery step for this credential
   * (same shown-once-banner convention as every other admin-issued temp password in this app).
   * Scoped by `ScopedRepository.findById` under a synthetic scope for this tenant, so a userId
   * belonging to a different tenant 404s here exactly like every other cross-tenant lookup in this
   * codebase (sec §3.2) — never a raw 403 that would confirm the id exists elsewhere.
   */
  @Post(':id/admins/:userId/reset-password')
  @HttpCode(200)
  async resetAdminPassword(@Param('id') id: string, @Param('userId') userId: string): Promise<ResetTenantAdminPasswordResponse> {
    const tenantId = toObjectId(id);
    const tenant = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: view tenant ${id}`, () => this.tenants.findById(tenantId));
    if (!tenant) throw new NotFoundException();

    const targetId = toObjectId(userId);
    const user = await this.runAsTenant(tenantId, tenant.edition, `platform-admin: view user ${userId} of tenant ${id}`, () => this.users.findById(targetId));
    if (!user) throw new NotFoundException();

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword, this.pepper);
    await this.runAsTenant(tenantId, tenant.edition, `platform-admin: reset password for user ${userId} of tenant ${id}`, () =>
      this.users.updateOne({ _id: targetId }, { $set: { passwordHash } }),
    );
    // Best-effort: forces re-login everywhere, matching TenantUsersAdminController.deactivate's
    // convention — depends on portal-api and apps/api sharing the same redis-app instance (ADR-0007),
    // which is true in every real deployment but not in an isolated local-only test double.
    await this.sessions.revokeAll('tenant', userId).catch(() => undefined);

    return { tempPassword };
  }

  /**
   * Tenant branding logo (Phase C, C1.3). PNG/JPEG only for v1 — SVG is deliberately excluded
   * (inline SVG can carry script content, a stored-XSS-via-logo vector) and left an explicitly
   * open, not decided, question for a later revisit (see the plan doc's "Open questions").
   * Deletes the previous logo object on re-upload so nothing is orphaned in storage.
   */
  @Post(':id/logo')
  @HttpCode(200)
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_LOGO_UPLOAD_BYTES } }))
  async uploadLogo(@Param('id') id: string, @UploadedFile() uploaded: Express.Multer.File | undefined): Promise<{ ok: true }> {
    const tenantId = toObjectId(id);
    const tenant = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: view tenant ${id}`, () => this.tenants.findById(tenantId));
    if (!tenant) throw new NotFoundException();

    if (!uploaded) throw new BadRequestException({ error: 'FILE_REQUIRED' });
    const sniffed = sniffFileType(uploaded.buffer);
    if (sniffed !== 'png' && sniffed !== 'jpg') {
      throw new UnsupportedMediaTypeException({ error: 'UNSUPPORTED_FILE_TYPE', message: 'Allowed types: PNG, JPG.' });
    }

    const contentHash = createHash('sha256').update(uploaded.buffer).digest('hex');
    const key = buildTenantLogoObjectKey(id, contentHash, sniffed);
    // 'inline': a logo is meant to render in the app shell, unlike a tenant-uploaded document
    // (sec §4.4 forces those to never render inline) — safe here because it was just
    // magic-byte-sniffed to PNG/JPEG only, which can't carry executable content.
    await this.storage.putObject(key, uploaded.buffer, { contentType: MIME_TYPES[sniffed], disposition: 'inline' });

    const previousKey = tenant.logoObjectKey;
    await SystemScope.run(this.cls, this.auditWrite, `platform-admin: set logo for tenant ${id}`, () =>
      this.tenants.updateOne(tenantId, { $set: { logoObjectKey: key } }),
    );
    if (previousKey && previousKey !== key) await this.storage.deleteObject(previousKey);

    return { ok: true };
  }

  @Patch(':id/suspend')
  async suspend(@Param('id') id: string): Promise<{ ok: true }> {
    await SystemScope.run(this.cls, this.auditWrite, `platform-admin: suspend tenant ${id}`, () =>
      this.tenants.setStatus(toObjectId(id), 'suspended'),
    );
    return { ok: true };
  }

  @Patch(':id/reactivate')
  async reactivate(@Param('id') id: string): Promise<{ ok: true }> {
    await SystemScope.run(this.cls, this.auditWrite, `platform-admin: reactivate tenant ${id}`, () =>
      this.tenants.setStatus(toObjectId(id), 'active'),
    );
    return { ok: true };
  }

  @Patch(':id/quota')
  async setQuota(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: true }> {
    const { storageQuotaBytes } = UpdateTenantQuotaRequestSchema.parse(body);
    await SystemScope.run(this.cls, this.auditWrite, `platform-admin: set quota for tenant ${id}`, () =>
      this.tenants.updateOne(toObjectId(id), { $set: { storageQuotaBytes } }),
    );
    return { ok: true };
  }

  /** Stub audit writer (PRD §12) — routes to the real auditEvents collection once ADR-0002's audit store lands. */
  private auditWrite = async (event: { reason: string; module: string; at: Date }): Promise<void> => {
    this.logger.log(`platform audit: ${JSON.stringify(event)}`);
  };

  /**
   * Runs `fn` under a synthetic per-tenant CLS scope — the same trick `provision()` and
   * `bootstrap/seed.ts` use to call a `ScopedRepository` (here, `UsersRepository`) from outside
   * any real tenant session. Deliberately NOT nested inside `SystemScope.run` (nestjs-cls's
   * `run()` starts a fresh store, so nesting it inside another `run()` would silently drop
   * whatever the outer one set) — audited directly via `auditWrite` instead, matching this
   * method's own already-working, already-tested shape.
   *
   * `fn` is explicitly `await`ed *inside* the `cls.run()` callback, not just returned — found via
   * live verification, not the (mocked) unit tests: `ScopedRepository.find()`/`findById()`/
   * `updateOne()` return a lazy Mongoose Query, not an already-started operation like `create()`.
   * Returning that unawaited lets `cls.run()` exit before the query actually executes, so by the
   * time Mongoose's tenant-scope backstop plugin (libs/data/src/backstop.plugin.ts) runs its
   * pre-hook, the synthetic scope this method set is already gone — it reads CLS at *execution*
   * time via `ClsServiceManager.getClsService()`, not at query-construction time — and throws
   * `UnscopedQueryError`. Awaiting inside the callback keeps the query's real execution within the
   * same continuation `cls.run()` is tracking.
   */
  private async runAsTenant<T>(tenantId: ObjectId, edition: Tenant['edition'], reason: string, fn: () => Promise<T>): Promise<T> {
    await this.auditWrite({ reason, module: 'platform-admin/tenants.controller', at: new Date() });
    const placeholderId = newObjectId(); // scope.userId is unused by ScopedRepository's queries here — same trick as provision()
    return this.cls.run(async () => {
      this.cls.set(SCOPE_CLS_KEY, { tenantId, userId: placeholderId, role: 'admin' as const, edition });
      return await fn();
    });
  }
}
