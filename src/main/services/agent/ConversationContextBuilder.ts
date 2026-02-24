import type { ChatTurn, DexterConfig, LongTermMemory, ModelHistoryRecord } from '@shared/contracts';
import {
  buildIdentityContext,
  buildIdentityProfilePatch,
  buildSafetyProtocolContext
} from '@main/services/agent/agent-consciousness';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';
import { collectEnvironmentSnapshot, formatEnvironmentForPrompt } from '@main/services/environment/environment-context';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

export interface PromptContextBundle {
  shortContext: ChatTurn[];
  longContext: LongTermMemory;
  identityContext: string;
  safetyContext: string;
  environmentContext: string;
  situationalContext: string;
}

type SnapshotProvider = (force?: boolean) => EnvironmentSnapshot;
type ConfigProvider = () => Pick<DexterConfig, 'model' | 'endpoint'>;

interface RuntimeContext {
  model: string;
  endpoint: string;
  endpointScope: 'local' | 'remote' | 'unknown';
}

export class ConversationContextBuilder {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly modelHistoryService: ModelHistoryService,
    private readonly snapshotProvider: SnapshotProvider = collectEnvironmentSnapshot,
    private readonly configProvider?: ConfigProvider
  ) {}

  buildForSession(sessionId: string, latestUserInput = ''): PromptContextBundle {
    const snapshot = this.snapshotProvider();
    const runtimeContext = this.configProvider ? buildRuntimeContext(this.configProvider()) : null;
    this.memoryStore.upsertProfileFacts(buildIdentityProfilePatch(snapshot, latestUserInput));
    const recentOperations = this.modelHistoryService.query({
      page: 1,
      pageSize: 3,
      operation: 'all',
      status: 'all'
    });
    const longContext = this.memoryStore.getLongMemory();

    return {
      shortContext: this.memoryStore.getShortContext(sessionId),
      longContext,
      identityContext: buildIdentityContext(snapshot, longContext),
      safetyContext: buildSafetyProtocolContext(),
      environmentContext: formatEnvironmentForPrompt(snapshot),
      situationalContext: formatSituationalContext(recentOperations.items, runtimeContext)
    };
  }

  buildFailureHint(): string {
    const snapshot = this.snapshotProvider();
    const ollama = snapshot.commands.find((item) => item.command === 'ollama');
    const systemctl = snapshot.commands.find((item) => item.command === 'systemctl');

    if (!ollama?.available) {
      return 'Nao encontrei o comando ollama no ambiente local. Instale o runtime e rode /health para validar.';
    }

    if (systemctl?.available) {
      return 'O comando ollama existe, mas o runtime pode estar parado. Tente iniciar com `ollama serve` (ou systemctl) e rode /health.';
    }

    return 'O comando ollama existe, mas o endpoint nao respondeu agora. Tente `ollama serve` e rode /health.';
  }
}

function formatSituationalContext(items: ModelHistoryRecord[], runtimeContext: RuntimeContext | null): string {
  const lines: string[] = [];

  if (runtimeContext) {
    lines.push(
      `Contexto operacional: modelo ativo ${runtimeContext.model}; endpoint ${runtimeContext.endpoint} (${formatEndpointScope(runtimeContext.endpointScope)}).`
    );
  }

  if (items.length === 0) {
    lines.push('Operacoes recentes de modelo: nenhuma operacao registrada.');
    return lines.join('\n');
  }

  lines.push('Operacoes recentes de modelo:');

  for (const item of items) {
    const status = formatStatus(item.status);
    const operation = item.operation.toUpperCase();
    const percent = typeof item.percent === 'number' ? ` ${Math.round(item.percent)}%` : '';
    lines.push(`- ${status} ${operation} ${item.model}${percent} (${formatWhen(item.startedAt)})`);
  }

  return lines.join('\n');
}

function formatStatus(status: ModelHistoryRecord['status']): string {
  if (status === 'running') {
    return 'em andamento';
  }

  if (status === 'done') {
    return 'concluido';
  }

  if (status === 'blocked') {
    return 'bloqueado';
  }

  return 'erro';
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildRuntimeContext(config: Pick<DexterConfig, 'model' | 'endpoint'>): RuntimeContext {
  return {
    model: config.model,
    endpoint: config.endpoint,
    endpointScope: classifyEndpoint(config.endpoint)
  };
}

function classifyEndpoint(endpoint: string): RuntimeContext['endpointScope'] {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();

    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return 'local';
    }

    if (!host) {
      return 'unknown';
    }

    return 'remote';
  } catch {
    return 'unknown';
  }
}

function formatEndpointScope(scope: RuntimeContext['endpointScope']): string {
  if (scope === 'local') {
    return 'endpoint local';
  }

  if (scope === 'remote') {
    return 'endpoint remoto';
  }

  return 'endpoint indefinido';
}
