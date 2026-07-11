import { z } from 'zod';

/**
 * Typed env loading. Grows as each app/worker pool needs new config;
 * kept centralized so a missing/malformed env var fails fast at boot
 * rather than surfacing as a runtime data-path bug.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(env);
}
