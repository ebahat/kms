import { Body, Controller, Get, Logger, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CreateTenantRequestSchema, UpdateTenantQuotaRequestSchema } from '@kms/contracts';
import { SystemScope, toObjectId, Tenant, TenantsRepository } from '@kms/data';

/**
 * Tenant lifecycle (PRD §5): create/configure/suspend/reactivate, set quotas.
 * Lives under platform-admin/** so SystemScope is importable here (ADR-0001
 * lint restriction) — every call is an audited cross-tenant action by nature.
 */
@Controller('platform-admin/tenants')
export class PlatformTenantsController {
  private readonly logger = new Logger('PlatformAudit');

  constructor(
    private readonly tenants: TenantsRepository,
    private readonly cls: ClsService,
  ) {}

  @Get()
  async list(): Promise<Tenant[]> {
    return SystemScope.run(this.cls, this.auditWrite, 'platform-admin: list tenants', () => this.tenants.find());
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<Tenant> {
    const tenant = await SystemScope.run(this.cls, this.auditWrite, `platform-admin: view tenant ${id}`, () =>
      this.tenants.findById(toObjectId(id)),
    );
    if (!tenant) throw new NotFoundException();
    return tenant;
  }

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
}
