import { Provider } from '@nestjs/common';
import type Redis from 'ioredis';
import { RateLimiter, LocalMasterKeyProvider, KmsKeyProvider } from '@kms/auth';
import { REDIS_APP_CLIENT } from '../redis.provider';
import { CaptchaVerifier, NoopCaptchaVerifier } from './captcha';
import { SecurityAlertSink, LoggingSecurityAlertSink } from './security-alerts';

export const PASSWORD_PEPPER = 'PASSWORD_PEPPER' as const;
export const KMS_KEY_PROVIDER = 'KMS_KEY_PROVIDER' as const;
export const RATE_LIMITER = 'RATE_LIMITER' as const;
export const CAPTCHA_VERIFIER = 'CAPTCHA_VERIFIER' as const;
export const SECURITY_ALERT_SINK = 'SECURITY_ALERT_SINK' as const;

export const passwordPepperProvider: Provider = {
  provide: PASSWORD_PEPPER,
  useFactory: (): string => {
    const pepper = process.env.PASSWORD_PEPPER;
    if (!pepper) throw new Error('PASSWORD_PEPPER env var is required (ADR-0004; sourced from Secret Manager in deployment).');
    return pepper;
  },
};

/** Dev/test binding — production swaps in a Cloud KMS-backed KmsKeyProvider once infra/ is applied (sec §7.2). */
export const kmsKeyProviderProvider: Provider = {
  provide: KMS_KEY_PROVIDER,
  useFactory: (): KmsKeyProvider => {
    const masterKeyHex = process.env.KMS_MASTER_KEY_HEX;
    if (!masterKeyHex) throw new Error('KMS_MASTER_KEY_HEX env var is required (sec §7.2).');
    return new LocalMasterKeyProvider(masterKeyHex);
  },
};

export const rateLimiterProvider: Provider = {
  provide: RATE_LIMITER,
  useFactory: (redis: Redis) => new RateLimiter(redis),
  inject: [REDIS_APP_CLIENT],
};

export const captchaVerifierProvider: Provider = {
  provide: CAPTCHA_VERIFIER,
  useClass: NoopCaptchaVerifier,
};

export const securityAlertSinkProvider: Provider = {
  provide: SECURITY_ALERT_SINK,
  useClass: LoggingSecurityAlertSink,
};

export type { CaptchaVerifier, SecurityAlertSink };
