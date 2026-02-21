import type { InstalledModel } from '@shared/contracts';

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    size?: number;
    modified_at?: string;
  }>;
}

export async function fetchInstalledModels(endpoint: string): Promise<InstalledModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: controller.signal
    });

    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as OllamaTagsResponse;
    const installed: InstalledModel[] = [];

    for (const model of json.models ?? []) {
      if (typeof model?.name !== 'string' || model.name.length === 0) {
        continue;
      }

      installed.push({
        name: model.name,
        sizeBytes: typeof model.size === 'number' ? model.size : 0,
        modifiedAt: typeof model.modified_at === 'string' ? model.modified_at : null
      });
    }

    installed.sort((a, b) => a.name.localeCompare(b.name));
    return installed;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
