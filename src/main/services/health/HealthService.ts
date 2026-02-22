import type { HealthReport } from '@shared/contracts';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';

export class HealthService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly memoryStore: MemoryStore,
    private readonly logger: Logger
  ) {}

  async report(): Promise<HealthReport> {
    const config = this.configStore.get();
    const details: string[] = [];

    const tags = await fetchTagsSnapshot(config.endpoint);
    const ollamaReachable = tags.reachable;
    if (!ollamaReachable) {
      details.push('Ollama nao foi encontrado no endpoint configurado.');
    }

    const modelAvailable = ollamaReachable ? tags.modelNames.includes(config.model) : false;
    if (ollamaReachable && !modelAvailable) {
      details.push(`Modelo ativo nao encontrado: ${config.model}`);
    }

    const memoryHealthy = this.memoryStore.isHealthy();
    if (!memoryHealthy) {
      details.push('Camada de memoria apresentou falha de leitura/escrita.');
    }

    const loggingHealthy = this.logger.isHealthy();
    if (!loggingHealthy) {
      details.push('Sistema de logs indisponivel.');
    }

    return {
      ok: ollamaReachable && modelAvailable && memoryHealthy && loggingHealthy,
      checkedAt: new Date().toISOString(),
      ollamaReachable,
      modelAvailable,
      memoryHealthy,
      loggingHealthy,
      details
    };
  }
}

interface TagsSnapshot {
  reachable: boolean;
  modelNames: string[];
}

async function fetchTagsSnapshot(endpoint: string): Promise<TagsSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  let snapshot: TagsSnapshot = {
    reachable: false,
    modelNames: []
  };

  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: controller.signal
    });

    if (!response.ok) {
      snapshot = {
        reachable: false,
        modelNames: []
      };
    } else {
      try {
        const json = (await response.json()) as { models?: Array<{ name?: string }> } | null;
        const modelNames = (json?.models ?? [])
          .map((item) => (typeof item?.name === 'string' ? item.name : ''))
          .filter((name): name is string => Boolean(name));

        snapshot = {
          reachable: true,
          modelNames
        };
      } catch {
        snapshot = {
          reachable: true,
          modelNames: []
        };
      }
    }
  } catch {
    snapshot = {
      reachable: false,
      modelNames: []
    };
  }

  clearTimeout(timeout);
  return snapshot;
}
