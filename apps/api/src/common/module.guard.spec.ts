import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { SCOPE_CLS_KEY } from '@kms/data';
import { MODULE_METADATA_KEY } from '@kms/contracts';
import { ModuleGuard } from './module.guard';

function makeContext(scope: { featureToggles: string[] } | undefined) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('ModuleGuard', () => {
  let guard: ModuleGuard;
  let cls: ClsService;
  let reflector: Reflector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ModuleGuard, Reflector, { provide: ClsService, useValue: { get: jest.fn() } }],
    }).compile();
    guard = moduleRef.get(ModuleGuard);
    cls = moduleRef.get(ClsService);
    reflector = moduleRef.get(Reflector);
  });

  it('allows a route with no @Module() requirement', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows a tenant whose featureToggles includes the required module', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('calendar');
    jest.spyOn(cls, 'get').mockReturnValue({ featureToggles: ['calendar'] });
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('404s a tenant whose featureToggles is missing the required module', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('kanban');
    jest.spyOn(cls, 'get').mockReturnValue({ featureToggles: ['calendar'] });
    expect(() => guard.canActivate(makeContext(undefined))).toThrow('Not Found');
  });
});
