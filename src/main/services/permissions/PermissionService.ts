import fs from 'node:fs';
import path from 'node:path';
import type { PermissionCheckResult, PermissionMode, PermissionPolicy, PermissionScope } from '@shared/contracts';

interface PersistedPermission {
  mode: PermissionMode;
  updatedAt: string;
}

interface PermissionFile {
  policies: Record<PermissionScope, PersistedPermission>;
}

export const ALL_PERMISSION_SCOPES: PermissionScope[] = [
  'runtime.install',
  'tools.filesystem.read',
  'tools.filesystem.write',
  'tools.system.exec'
];

const DEFAULT_MODES: Record<PermissionScope, PermissionMode> = {
  'runtime.install': 'ask',
  'tools.filesystem.read': 'ask',
  'tools.filesystem.write': 'ask',
  'tools.system.exec': 'ask'
};

export class PermissionService {
  private readonly filePath: string;
  private fileCache: PermissionFile;

  constructor(baseDir: string) {
    const permissionsDir = path.join(baseDir, 'permissions');
    fs.mkdirSync(permissionsDir, { recursive: true });

    this.filePath = path.join(permissionsDir, 'policies.json');
    this.fileCache = this.load();
  }

  list(): PermissionPolicy[] {
    return ALL_PERMISSION_SCOPES.map((scope) => ({
      scope,
      mode: this.fileCache.policies[scope].mode,
      updatedAt: this.fileCache.policies[scope].updatedAt
    }));
  }

  mode(scope: PermissionScope): PermissionMode {
    return this.fileCache.policies[scope].mode;
  }

  set(scope: PermissionScope, mode: PermissionMode): PermissionPolicy[] {
    this.fileCache.policies[scope] = {
      mode,
      updatedAt: new Date().toISOString()
    };

    this.persist(this.fileCache);
    return this.list();
  }

  check(scope: PermissionScope, action: string): PermissionCheckResult {
    const mode = this.mode(scope);

    if (mode === 'allow') {
      return {
        scope,
        action,
        mode,
        allowed: true,
        requiresPrompt: false,
        message: `Permitido por politica: ${scope}.`
      };
    }

    if (mode === 'deny') {
      return {
        scope,
        action,
        mode,
        allowed: false,
        requiresPrompt: false,
        message: `Bloqueado por politica: ${scope}.`
      };
    }

    return {
      scope,
      action,
      mode,
      allowed: false,
      requiresPrompt: true,
      message: `Dexter solicita confirmacao para: ${action}.`
    };
  }

  private load(): PermissionFile {
    if (!fs.existsSync(this.filePath)) {
      const initial = this.createDefaultFile();
      this.persist(initial);
      return initial;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PermissionFile;

      for (const scope of ALL_PERMISSION_SCOPES) {
        const value = parsed.policies?.[scope]?.mode;
        if (!isPermissionMode(value)) {
          throw new Error(`Invalid mode for scope ${scope}`);
        }
      }

      return parsed;
    } catch {
      const fallback = this.createDefaultFile();
      this.persist(fallback);
      return fallback;
    }
  }

  private persist(file: PermissionFile): void {
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  private createDefaultFile(): PermissionFile {
    const now = new Date().toISOString();

    return {
      policies: {
        'runtime.install': {
          mode: DEFAULT_MODES['runtime.install'],
          updatedAt: now
        },
        'tools.filesystem.read': {
          mode: DEFAULT_MODES['tools.filesystem.read'],
          updatedAt: now
        },
        'tools.filesystem.write': {
          mode: DEFAULT_MODES['tools.filesystem.write'],
          updatedAt: now
        },
        'tools.system.exec': {
          mode: DEFAULT_MODES['tools.system.exec'],
          updatedAt: now
        }
      }
    };
  }
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'allow' || value === 'ask' || value === 'deny';
}
