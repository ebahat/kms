import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * The platform-admin realm's own user store (ADR-0004) — completely separate
 * from `users`: no tenantId, no ScopedRepository (there is nothing to scope
 * by), never touched by the tenant session cookie or guard. TOTP is
 * mandatory with NO self-service backup-code reset: a locked-out admin's
 * MFA can only be cleared by a second platform admin approving the reset
 * (two-person control) — see PlatformAdminsRepository.requestMfaReset /
 * approveMfaReset.
 */
@Schema({ collection: 'platformAdmins', timestamps: true })
export class PlatformAdmin {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: ['active', 'inactive'], default: 'active' })
  status!: 'active' | 'inactive';

  @Prop({ default: false })
  mfaEnabled!: boolean;

  @Prop({ type: Object })
  totpSecretEnvelope?: { ciphertext: string; wrappedKey: string; iv: string; authTag: string };

  /** Set when a peer admin initiates a reset; cleared (with the secret) on approval by a DIFFERENT admin. */
  @Prop({ type: Types.ObjectId })
  pendingMfaResetRequestedBy?: Types.ObjectId;

  @Prop()
  pendingMfaResetRequestedAt?: Date;

  @Prop()
  lastLoginAt?: Date;
}

export type PlatformAdminDocument = HydratedDocument<PlatformAdmin> & { _id: Types.ObjectId };
export const PlatformAdminSchema = SchemaFactory.createForClass(PlatformAdmin);
