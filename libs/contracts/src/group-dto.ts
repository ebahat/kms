import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

/** Caps whatever tier a folder grants this group — never widens it (user-management plan, 2026-08-24). */
export const GroupMemberRoleSchema = z.enum(['viewer', 'editor', 'manager']);
export type GroupMemberRole = z.infer<typeof GroupMemberRoleSchema>;

export const CreateGroupRequestSchema = z.object({ name: z.string().trim().min(1).max(255) });
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

/** Same shape as create — a rename is just "the name field, again." */
export const UpdateGroupRequestSchema = CreateGroupRequestSchema;
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

/**
 * `add` carries a role per member (there is no "add without a role" state); `remove` is bare ids.
 * `remove` still runs before `add` in the controller — an id appearing in both is treated as "add
 * with this role" (GroupsController.updateMembers's existing precedent, unchanged).
 */
export const UpdateGroupMembersRequestSchema = z.object({
  add: z.array(z.object({ userId: objectIdString, role: GroupMemberRoleSchema })).default([]),
  remove: z.array(objectIdString).default([]),
});
export type UpdateGroupMembersRequest = z.infer<typeof UpdateGroupMembersRequestSchema>;
