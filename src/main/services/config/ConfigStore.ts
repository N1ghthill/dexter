import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { DexterConfig } from '@shared/contracts';

const configSchema = z.object({
  model: z.string().min(1),
  endpoint: z.string().url(),
  personality: z.string().min(1)
});

const DEFAULT_CONFIG: DexterConfig = {
  model: 'llama3.2:3b',
  endpoint: 'http://127.0.0.1:11434',
  personality:
    'Voce e Dexter, um assistente local prestativo, obediente e consciente do ambiente. Seja claro, objetivo e pratico, sem extrapolar seguranca.'
};

export class ConfigStore {
  private readonly filePath: string;
  private cache: DexterConfig;

  constructor(baseDir: string) {
    const configDir = path.join(baseDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    this.filePath = path.join(configDir, 'dexter.config.json');
    this.cache = this.load();
  }

  get(): DexterConfig {
    return this.cache;
  }

  setModel(model: string): DexterConfig {
    const sanitized = model.trim();
    if (!sanitized) {
      return this.cache;
    }

    this.cache = { ...this.cache, model: sanitized };
    this.persist(this.cache);
    return this.cache;
  }

  private load(): DexterConfig {
    if (!fs.existsSync(this.filePath)) {
      this.persist(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = configSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // fallback
    }

    this.persist(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  private persist(config: DexterConfig): void {
    fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
