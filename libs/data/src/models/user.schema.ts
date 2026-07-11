import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * Internal user directory (ADR-0002, PRD §6). Tenant-owned — accessed only
 * via UsersRepository (ScopedRepository). `email` is globally unique: MVP
 * login resolves the tenant FROM the email (no per-tenant hostname/subdomain
 * routing exists — ADR-0007/0009 only give the platform-admin realm its own
 * hostname), so one person has exactly one account across the whole system.
 * TOTP secret and backup codes are envelope-encrypted/hashed — never plaintext
 * (sec §7.2).
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: ['user', 'admin'], default: 'user' })
  role!: 'user' | 'admin';

  /** 'locked' is set by login hardening after repeated failures and cleared only by a tenant admin (PRD §3). */
  @Prop({ required: true, enum: ['active', 'inactive', 'locked'], default: 'active' })
  status!: 'active' | 'inactive' | 'locked';

  @Prop({ default: false })
  mfaEnabled!: boolean;

  /** Envelope-encrypted (KMS data key) TOTP secret — ciphertext + wrapped data key + iv/tag (sec §7.2). */
  @Prop({ type: Object })
  totpSecretEnvelope?: { ciphertext: string; wrappedKey: string; iv: string; authTag: string };

  /** Argon2id-hashed single-use backup codes; consumed codes are removed, not flagged (sec §2). */
  @Prop({ type: [String], default: [] })
  totpBackupCodeHashes!: string[];

  @Prop()
  tosAcceptedVersion?: string;

  @Prop()
  tosAcceptedAt?: Date;

  @Prop()
  lastLoginAt?: Date;

  /** SHA-256 hash of a 128-bit single-use token, ≤30min expiry (sec §2) — never the raw token. */
  @Prop()
  passwordResetTokenHash?: string;

  @Prop()
  passwordResetExpiresAt?: Date;
}

export type UserDocument = HydratedDocument<User> & { _id: Types.ObjectId };
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ tenantId: 1, status: 1 });
UserSchema.plugin(tenantScopeBackstopPlugin);
