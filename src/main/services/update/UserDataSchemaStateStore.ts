import fs from 'node:fs';
import path from 'node:path';

export interface UserDataSchemaState {
  version: number;
  updatedAt: string;
}

interface PersistedUserDataSchemaStateFile {
  state: UserDataSchemaState;
}

export class UserDataSchemaStateStore {
  private readonly filePath: string;
  private cache: UserDataSchemaState | null;

  constructor(baseDir: string) {
    const updateDir = path.join(baseDir, 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    this.filePath = path.join(updateDir, 'user-data-schema-state.json');
    this.cache = this.load();
  }

  get(): UserDataSchemaState | null {
    return this.cache ? { ...this.cache } : null;
  }

  setVersion(version: number): UserDataSchemaState {
    const normalized = Math.max(0, Math.trunc(version));
    const next: UserDataSchemaState = {
      version: normalized,
      updatedAt: new Date().toISOString()
    };

    this.cache = next;
    const file: PersistedUserDataSchemaStateFile = { state: next };
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    return { ...next };
  }

  private load(): UserDataSchemaState | null {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedUserDataSchemaStateFile>;
      const state = parsed.state;
      if (
        state &&
        typeof state.version === 'number' &&
        Number.isFinite(state.version) &&
        state.version >= 0 &&
        typeof state.updatedAt === 'string' &&
        Number.isFinite(Date.parse(state.updatedAt))
      ) {
        return {
          version: Math.trunc(state.version),
          updatedAt: state.updatedAt
        };
      }
    } catch {
      // fallback to null (adopt current on next runner pass)
    }

    return null;
  }
}

