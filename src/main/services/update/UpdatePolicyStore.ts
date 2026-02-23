import fs from 'node:fs';
import path from 'node:path';
import type { UpdatePolicy, UpdatePolicyPatch } from '@shared/contracts';

interface PersistedUpdatePolicyFile {
  policy: UpdatePolicy;
}

const DEFAULT_POLICY_BASE = {
  channel: 'stable',
  autoCheck: true
} as const;

export class UpdatePolicyStore {
  private readonly filePath: string;
  private cache: UpdatePolicy;

  constructor(baseDir: string) {
    const updateDir = path.join(baseDir, 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    this.filePath = path.join(updateDir, 'policy.json');
    this.cache = this.load();
  }

  get(): UpdatePolicy {
    return { ...this.cache };
  }

  set(patch: UpdatePolicyPatch): UpdatePolicy {
    const next: UpdatePolicy = {
      channel: patch.channel ?? this.cache.channel,
      autoCheck: typeof patch.autoCheck === 'boolean' ? patch.autoCheck : this.cache.autoCheck,
      updatedAt: new Date().toISOString()
    };

    this.cache = next;
    this.persist(next);
    return this.get();
  }

  private load(): UpdatePolicy {
    if (!fs.existsSync(this.filePath)) {
      const initial = createDefaultPolicy();
      this.persist(initial);
      return initial;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedUpdatePolicyFile>;
      const normalized = normalizePolicy(parsed.policy);
      this.persist(normalized);
      return normalized;
    } catch {
      const fallback = createDefaultPolicy();
      this.persist(fallback);
      return fallback;
    }
  }

  private persist(policy: UpdatePolicy): void {
    const file: PersistedUpdatePolicyFile = { policy };
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

function createDefaultPolicy(): UpdatePolicy {
  return {
    channel: DEFAULT_POLICY_BASE.channel,
    autoCheck: DEFAULT_POLICY_BASE.autoCheck,
    updatedAt: new Date().toISOString()
  };
}

function normalizePolicy(input: unknown): UpdatePolicy {
  if (!input || typeof input !== 'object') {
    return createDefaultPolicy();
  }

  const value = input as Partial<UpdatePolicy>;
  const fallback = createDefaultPolicy();

  return {
    channel: value.channel === 'rc' ? 'rc' : 'stable',
    autoCheck: typeof value.autoCheck === 'boolean' ? value.autoCheck : fallback.autoCheck,
    updatedAt: isIso(value.updatedAt) ? value.updatedAt : fallback.updatedAt
  };
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
