import { z } from 'zod';
import { GroupMemberRoleSchema } from './group-dto';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

/** A group assignment carried on user create/update — the group is referenced by id here (the UI
 * resolves a picked group to its id); CSV import resolves by name instead, see parseCsvGroupsCell. */
export const UserGroupAssignmentSchema = z.object({ groupId: objectIdString, role: GroupMemberRoleSchema });
export type UserGroupAssignment = z.infer<typeof UserGroupAssignmentSchema>;

/** Tenant-admin user management (PRD §6). */
export const CreateUserRequestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(['user', 'admin']).default('user'),
  groups: z.array(UserGroupAssignmentSchema).default([]),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

/** Every field optional (PATCH semantics) but at least one must be present — enforced in the controller, not here, since zod's "at least one key" is awkward to express and the controller already needs a clear 400 message. */
export const UpdateUserRequestSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['user', 'admin']).optional(),
  groups: z.array(UserGroupAssignmentSchema).optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/**
 * `groups` is a raw string cell here, not yet resolved — CSV rows reference groups by *name*
 * (`"Sales:editor;Legal:viewer"`), since a CSV author has no group ids. The controller resolves
 * each name to an id (or reports a row error for an unknown name) before calling the repository.
 */
export const CsvImportRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(['user', 'admin']).default('user'),
  groups: z.string().optional(),
});
export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;

export const ImportUsersRequestSchema = z.object({
  csvContent: z.string().min(1),
});
export type ImportUsersRequest = z.infer<typeof ImportUsersRequestSchema>;

export type CsvImportRowResult = {
  row: number;
  email?: string;
  status: 'created' | 'error';
  error?: string;
};

export type UserSummary = {
  id: string;
  email: string;
  firstName?: string; // absent for accounts created before this field existed
  lastName?: string;
  role: 'user' | 'admin';
  /** 'pending' = invited, activation link not yet used (user-management plan, 2026-08-24). */
  status: 'pending' | 'active' | 'inactive' | 'locked';
  mfaEnabled: boolean;
  lastLoginAt?: Date;
};

/**
 * Deliberately minimal — NOT `UserSummary` — the "add member by email" / "grant by email" pickers
 * (2026-08-28 bug fix) are reachable by any authenticated tenant member, not just admins, so this
 * shape omits everything `UserSummary` exposes that's admin-only-appropriate (role, status,
 * mfaEnabled, lastLoginAt). `name` falls back to the email when both name fields are absent, same
 * precedent as `User.firstName`'s own doc comment.
 */
export type UserLookupResult = {
  id: string;
  email: string;
  name: string;
};

export type CreateUserResult = { userId: string; email: string; status: 'pending' };
