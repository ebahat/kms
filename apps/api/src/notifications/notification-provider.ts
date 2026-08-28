/**
 * Transactional email abstraction (ADR-0013). Mirrors StorageProvider's
 * shape (libs/storage/src/storage-provider.ts) — one small interface,
 * swappable concrete adapter, no shared libs/notifications package needed
 * for a single method.
 */
export type SendEmailArgs = { to: string; subject: string; body: string };

export interface NotificationProvider {
  sendEmail(args: SendEmailArgs): Promise<void>;
}
