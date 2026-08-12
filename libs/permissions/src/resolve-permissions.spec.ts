import { computeFolderWidening, resolveFolderPermissions } from './resolve-permissions';
import { FolderInput } from './types';

function folder(id: string, parentId: string | null, overrides: Partial<FolderInput> = {}): FolderInput {
  return {
    id,
    parentId,
    grants: [],
    hasExplicitGrants: false,
    isPublic: false,
    ...overrides,
  };
}

describe('resolveFolderPermissions (ADR-0005)', () => {
  const userId = 'user-1';
  const groupId = 'group-1';
  const otherUserId = 'user-2';
  const principals = { userId, groupIds: [groupId] };

  it('grants no access to a folder with no grants and not public', () => {
    const result = resolveFolderPermissions([folder('f1', null)], principals);
    expect(result.permittedRead).toEqual([]);
    expect(result.decidingGrant.has('f1')).toBe(false);
  });

  it('public folders grant read to every principal', () => {
    const result = resolveFolderPermissions([folder('f1', null, { isPublic: true, hasExplicitGrants: true })], principals);
    expect(result.permittedRead).toEqual(['f1']);
    expect(result.permittedEdit).toEqual([]);
    expect(result.decidingGrant.get('f1')).toEqual({ tier: 'read', via: 'public' });
  });

  it.each(['read', 'edit', 'manage'] as const)('a direct user grant at "%s" tier includes it in exactly the right superset arrays', (tier) => {
    const result = resolveFolderPermissions(
      [folder('f1', null, { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: tier }] })],
      principals,
    );
    expect(result.permittedRead).toEqual(['f1']);
    expect(result.permittedEdit).toEqual(tier === 'edit' || tier === 'manage' ? ['f1'] : []);
    expect(result.permittedManage).toEqual(tier === 'manage' ? ['f1'] : []);
  });

  it('a group grant applies to every member (group principal)', () => {
    const result = resolveFolderPermissions(
      [folder('f1', null, { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupId, access: 'edit' }] })],
      principals,
    );
    expect(result.permittedEdit).toEqual(['f1']);
    expect(result.decidingGrant.get('f1')).toEqual({ tier: 'edit', via: { principalType: 'group', principalId: groupId } });
  });

  it('a grant naming a different user does not apply', () => {
    const result = resolveFolderPermissions(
      [folder('f1', null, { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: otherUserId, access: 'manage' }] })],
      principals,
    );
    expect(result.permittedRead).toEqual([]);
  });

  it('union rule: the highest tier from any direct-or-group grant wins', () => {
    const result = resolveFolderPermissions(
      [
        folder('f1', null, {
          hasExplicitGrants: true,
          grants: [
            { principalType: 'user', principalId: userId, access: 'read' },
            { principalType: 'group', principalId: groupId, access: 'manage' },
          ],
        }),
      ],
      principals,
    );
    expect(result.permittedManage).toEqual(['f1']);
    expect(result.decidingGrant.get('f1')?.tier).toBe('manage');
  });

  it('a subfolder without explicit grants inherits its parent effective grants unchanged', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'edit' }] }),
      folder('child', 'parent'),
    ];
    const result = resolveFolderPermissions(folders, principals);
    expect(result.permittedEdit).toEqual(expect.arrayContaining(['parent', 'child']));
  });

  it('an explicit override replaces the parent grants entirely rather than merging with them', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'manage' }] }),
      folder('child', 'parent', { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: otherUserId, access: 'read' }] }),
    ];
    const result = resolveFolderPermissions(folders, principals);
    expect(result.permittedManage).toEqual(['parent']);
    expect(result.permittedRead).toEqual(['parent']); // child excluded — override, not merge
  });

  it('a tie between public read and a named read grant prefers the public explanation', () => {
    const result = resolveFolderPermissions(
      [
        folder('f1', null, {
          hasExplicitGrants: true,
          isPublic: true,
          grants: [{ principalType: 'user', principalId: userId, access: 'read' }],
        }),
      ],
      principals,
    );
    expect(result.decidingGrant.get('f1')).toEqual({ tier: 'read', via: 'public' });
  });

  it('a named grant strictly above the public tier wins over public', () => {
    const result = resolveFolderPermissions(
      [
        folder('f1', null, {
          hasExplicitGrants: true,
          isPublic: true,
          grants: [{ principalType: 'user', principalId: userId, access: 'manage' }],
        }),
      ],
      principals,
    );
    expect(result.decidingGrant.get('f1')).toEqual({ tier: 'manage', via: { principalType: 'user', principalId: userId } });
  });

  it('fails closed (not throws) when a folder references a parent that is not in the input set — the folder gets no access rather than aborting resolution', () => {
    const result = resolveFolderPermissions([folder('orphan', 'missing-parent')], principals);
    expect(result.permittedRead).toEqual([]);
    expect(result.decidingGrant.has('orphan')).toBe(false);
  });

  it('an orphaned folder does not take down resolution for the rest of the tenant', () => {
    const folders = [
      folder('orphan', 'missing-parent'),
      folder('healthy', null, { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] }),
    ];
    const result = resolveFolderPermissions(folders, principals);
    expect(result.permittedRead).toEqual(['healthy']);
  });

  it('a folder inheriting from an orphaned parent also gets no access (deny-all propagates down the subtree)', () => {
    const folders = [folder('orphan', 'missing-parent'), folder('child-of-orphan', 'orphan')];
    const result = resolveFolderPermissions(folders, principals);
    expect(result.permittedRead).toEqual([]);
  });

  it('throws on a cyclic parent chain instead of infinite-looping', () => {
    const folders = [folder('a', 'b', { hasExplicitGrants: false }), folder('b', 'a', { hasExplicitGrants: false })];
    expect(() => resolveFolderPermissions(folders, principals)).toThrow(/cycle detected/);
  });
});

describe('computeFolderWidening (ADR-0005, amended 2026-07-19)', () => {
  const userId = 'user-1';
  const groupA = 'group-a';
  const groupB = 'group-b';

  it('a root folder is never flagged (no parent to compare against)', () => {
    const result = computeFolderWidening([folder('root', null, { hasExplicitGrants: true, isPublic: true })]);
    expect(result.get('root')).toEqual({ broaderThanParent: false, addedGroups: [], becamePublic: false });
  });

  it('pure inheritance (no override) is never broader than its parent', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'read' }] }),
      folder('child', 'parent'),
    ];
    expect(computeFolderWidening(folders).get('child')?.broaderThanParent).toBe(false);
  });

  it('an override that only narrows (removes a group) is not flagged broader', () => {
    const folders = [
      folder('parent', null, {
        hasExplicitGrants: true,
        grants: [
          { principalType: 'group', principalId: groupA, access: 'read' },
          { principalType: 'group', principalId: groupB, access: 'read' },
        ],
      }),
      folder('child', 'parent', { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'read' }] }),
    ];
    const info = computeFolderWidening(folders).get('child')!;
    expect(info.broaderThanParent).toBe(false);
    expect(info.addedGroups).toEqual([]);
  });

  it('an override that adds a new group is flagged broader and names the added group', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'read' }] }),
      folder('child', 'parent', {
        hasExplicitGrants: true,
        grants: [
          { principalType: 'group', principalId: groupA, access: 'read' },
          { principalType: 'group', principalId: groupB, access: 'read' },
        ],
      }),
    ];
    const info = computeFolderWidening(folders).get('child')!;
    expect(info.broaderThanParent).toBe(true);
    expect(info.addedGroups).toEqual([groupB]);
    expect(info.becamePublic).toBe(false);
  });

  it('an override that only escalates tier for the same principals is not flagged (audience, not capability)', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'read' }] }),
      folder('child', 'parent', { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'manage' }] }),
    ];
    const info = computeFolderWidening(folders).get('child')!;
    expect(info.broaderThanParent).toBe(false);
    expect(info.addedGroups).toEqual([]);
  });

  it('flipping isPublic false->true is flagged broader with becamePublic true', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] }),
      folder('child', 'parent', { hasExplicitGrants: true, isPublic: true }),
    ];
    const info = computeFolderWidening(folders).get('child')!;
    expect(info.broaderThanParent).toBe(true);
    expect(info.becamePublic).toBe(true);
  });

  it('flipping isPublic true->false (narrowing) is not flagged broader', () => {
    const folders = [
      folder('parent', null, { hasExplicitGrants: true, isPublic: true }),
      folder('child', 'parent', { hasExplicitGrants: true, isPublic: false, grants: [{ principalType: 'user', principalId: userId, access: 'read' }] }),
    ];
    const info = computeFolderWidening(folders).get('child')!;
    expect(info.broaderThanParent).toBe(false);
    expect(info.becamePublic).toBe(false);
  });

  it('does not crash when a folder with its own explicit grants points at a dangling parentId — the parent side treats as deny-all', () => {
    // hasExplicitGrants: true means this folder never inherits, so computeEffectiveBundles never
    // even visits "missing-parent" via its own resolve() recursion — a different path to the same
    // missing-map-key hazard the orphan case hits, both must be safe against the bare `!` lookup.
    const folders = [
      folder('child', 'missing-parent', { hasExplicitGrants: true, grants: [{ principalType: 'group', principalId: groupA, access: 'read' }] }),
    ];
    const info = computeFolderWidening(folders).get('child')!;
    expect(info.broaderThanParent).toBe(true); // any grant is broader than a deny-all (nonexistent) parent
    expect(info.addedGroups).toEqual([groupA]);
  });
});
