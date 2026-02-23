import fs from 'node:fs';
import path from 'node:path';
import { ALL_PERMISSION_SCOPES } from '@main/services/permissions/PermissionService';

export interface UserDataMigrationStep {
  id: string;
  fromVersion: number;
  toVersion: number;
  run(baseDir: string): void;
}

const DEFAULT_PERMISSION_MODE = 'ask';

export const BUILTIN_USER_DATA_MIGRATIONS: UserDataMigrationStep[] = [
  {
    id: 'permissions-policy-shape-v2',
    fromVersion: 1,
    toVersion: 2,
    run: migratePermissionsPolicyShapeV2
  }
];

function migratePermissionsPolicyShapeV2(baseDir: string): void {
  const filePath = path.join(baseDir, 'permissions', 'policies.json');
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as {
    policies?: Record<string, { mode?: unknown; updatedAt?: unknown }>;
  };

  const now = new Date().toISOString();
  const source = parsed.policies ?? {};
  const normalizedPolicies: Record<string, { mode: 'allow' | 'ask' | 'deny'; updatedAt: string }> = {};

  for (const scope of ALL_PERMISSION_SCOPES) {
    const current = source[scope];
    normalizedPolicies[scope] = {
      mode: isPermissionMode(current?.mode) ? current.mode : DEFAULT_PERMISSION_MODE,
      updatedAt: isIso(current?.updatedAt) ? current.updatedAt : now
    };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        policies: normalizedPolicies
      },
      null,
      2
    ),
    'utf-8'
  );
}

function isPermissionMode(value: unknown): value is 'allow' | 'ask' | 'deny' {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

