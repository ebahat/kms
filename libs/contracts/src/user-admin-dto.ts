import { z } from 'zod';

/** Tenant-admin user management (PRD §6). */
export const CreateUserRequestSchema = z.object({
  email: z.string().email(),
  role: z.enum(['user', 'admin']).default('user'),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const CsvImportRowSchema = z.object({
  email: z.string().email(),
  role: z.enum(['user', 'admin']).default('user'),
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
  role: 'user' | 'admin';
  status: 'active' | 'inactive' | 'locked';
  mfaEnabled: boolean;
  lastLoginAt?: Date;
};
