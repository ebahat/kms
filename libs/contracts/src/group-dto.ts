import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

export const CreateGroupRequestSchema = z.object({ name: z.string().trim().min(1).max(255) });
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const UpdateGroupMembersRequestSchema = z.object({
  add: z.array(objectIdString).default([]),
  remove: z.array(objectIdString).default([]),
});
export type UpdateGroupMembersRequest = z.infer<typeof UpdateGroupMembersRequestSchema>;
