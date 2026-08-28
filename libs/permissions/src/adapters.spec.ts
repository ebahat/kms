import { toFolderInput, toFolderInputs, toPrincipalSet } from './adapters';

/** Stands in for a mongoose ObjectId (toString() only) without importing mongoose — banned outside libs/data (ADR-0001). */
function fakeId(hex: string) {
  return { toString: () => hex };
}

describe('adapters (@kms/data document -> plain resolver input)', () => {
  it('toFolderInput converts ObjectId-shaped fields to strings', () => {
    const id = fakeId('folder-1');
    const parentId = fakeId('parent-1');
    const principalId = fakeId('user-1');
    const doc = {
      _id: id,
      parentId,
      grants: [{ principalType: 'user' as const, principalId, access: 'edit' as const }],
      hasExplicitGrants: true,
      isPublic: false,
    } as any;

    expect(toFolderInput(doc)).toEqual({
      id: 'folder-1',
      parentId: 'parent-1',
      grants: [{ principalType: 'user', principalId: 'user-1', access: 'edit' }],
      hasExplicitGrants: true,
      isPublic: false,
    });
  });

  it('toFolderInput maps a null parentId (root folder) through as null', () => {
    const doc = { _id: fakeId('folder-1'), parentId: null, grants: [], hasExplicitGrants: false, isPublic: false } as any;
    expect(toFolderInput(doc).parentId).toBeNull();
  });

  it('toFolderInputs maps an array', () => {
    const doc = { _id: fakeId('folder-1'), parentId: null, grants: [], hasExplicitGrants: false, isPublic: false } as any;
    expect(toFolderInputs([doc])).toEqual([toFolderInput(doc)]);
  });

  it('toPrincipalSet pairs the user id with their role in each group', () => {
    const groups = [
      { _id: fakeId('group-1'), members: [{ userId: fakeId('user-1'), role: 'editor' }] } as any,
      { _id: fakeId('group-2'), members: [{ userId: fakeId('user-1'), role: 'viewer' }, { userId: fakeId('user-2'), role: 'manager' }] } as any,
    ];
    expect(toPrincipalSet('user-1', groups)).toEqual({
      userId: 'user-1',
      groups: [
        { groupId: 'group-1', role: 'editor' },
        { groupId: 'group-2', role: 'viewer' },
      ],
    });
  });

  it('toPrincipalSet ignores other members’ roles and drops a group where the user has no membership row', () => {
    const groups = [{ _id: fakeId('group-1'), members: [{ userId: fakeId('user-2'), role: 'manager' }] } as any];
    expect(toPrincipalSet('user-1', groups)).toEqual({ userId: 'user-1', groups: [] });
  });
});
