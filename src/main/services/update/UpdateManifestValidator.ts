import { z } from 'zod';
import type { UpdateManifest } from '@shared/contracts';

const manifestSchema = z.object({
  version: z.string().min(1),
  channel: z.enum(['stable', 'rc']),
  provider: z.enum(['none', 'mock', 'github']),
  publishedAt: z.string().datetime(),
  releaseNotes: z.string(),
  downloadUrl: z.string().url(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/, 'checksumSha256 must be a 64-char hex SHA256'),
  components: z.object({
    appVersion: z.string().min(1),
    coreVersion: z.string().min(1),
    uiVersion: z.string().min(1),
    ipcContractVersion: z.number().int().nonnegative(),
    userDataSchemaVersion: z.number().int().nonnegative()
  }),
  compatibility: z.object({
    strategy: z.enum(['atomic', 'ui-only']),
    requiresRestart: z.boolean(),
    ipcContractCompatible: z.boolean(),
    userDataSchemaCompatible: z.boolean(),
    notes: z.array(z.string())
  })
});

export class UpdateManifestValidator {
  validate(input: unknown): { ok: true; manifest: UpdateManifest } | { ok: false; error: string } {
    const parsed = manifestSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
      };
    }

    return {
      ok: true,
      manifest: parsed.data
    };
  }
}
