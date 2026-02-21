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

    const ollamaReachable = await isOllamaReachable(config.endpoint);
    if (!ollamaReachable) {
      details.push('Ollama nao foi encontrado no endpoint configurado.');
    }

    const modelAvailable = ollamaReachable ? await isModelAvailable(config.endpoint, config.model) : false;
    if (!modelAvailable) {
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

async function isOllamaReachable(endpoint: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function isModelAvailable(endpoint: string, model: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return false;
    }

    const json = (await response.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? []).some((item) => item.name === model);
  } catch {
    return false;
  }
}
