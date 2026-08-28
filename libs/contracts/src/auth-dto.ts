import { z } from 'zod';

/** Shared API<->web contract for the auth endpoints (ADR-0004, ADR-0009). */
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  captchaToken: z.string().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TotpVerifyRequestSchema = z.object({
  code: z.string().min(6).max(64), // backup codes are longer than a 6-digit TOTP token
});
export type TotpVerifyRequest = z.infer<typeof TotpVerifyRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  newPassword: z.string().min(12), // sec §2 minimum length floor
});
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirmSchema>;

export const TosAcceptRequestSchema = z.object({
  version: z.string().min(1),
});
export type TosAcceptRequest = z.infer<typeof TosAcceptRequestSchema>;

/** Invite-activation flow (user-management plan, 2026-08-24) — replaces the one-time temp-password display. */
export const ActivateCheckRequestSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
});
export type ActivateCheckRequest = z.infer<typeof ActivateCheckRequestSchema>;

export const ActivateConfirmRequestSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  newPassword: z.string().min(12), // same floor as password-reset — one policy, not two
});
export type ActivateConfirmRequest = z.infer<typeof ActivateConfirmRequestSchema>;
