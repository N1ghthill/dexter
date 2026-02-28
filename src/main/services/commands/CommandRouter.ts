import type {
  ChatReply,
  LongTermMemory,
  MemorySnapshot,
  ModelHistoryQuery,
  ModelHistoryRecord,
  RuntimeStatus
} from '@shared/contracts';
import {
  buildIdentityContext,
  buildPreferredUserNamePatch,
  resolveSessionPreferredUserName,
  buildSafetyProtocolContext
} from '@main/services/agent/agent-consciousness';
import { buildSituationalAwarenessContext } from '@main/services/agent/situational-awareness';
import { COMMAND_HELP } from '@shared/command-help';
import { ConfigStore } from '@main/services/config/ConfigStore';
import {
  collectEnvironmentSnapshot,
  formatEnvironmentForCommand,
  type EnvironmentSnapshot
} from '@main/services/environment/environment-context';
import { HealthService } from '@main/services/health/HealthService';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

export class CommandRouter {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly memoryStore: MemoryStore,
    private readonly healthService: HealthService,
    private readonly modelHistoryService: ModelHistoryService,
    private readonly runtimeStatusProvider?: {
      status(): Promise<RuntimeStatus>;
    }
  ) {}

  async tryExecute(input: string, sessionId: string): Promise<ChatReply | null> {
    if (!input.startsWith('/')) {
      return null;
    }

    const [command, ...args] = input.trim().split(/\s+/);

    switch (command) {
      case '/help':
        return reply(COMMAND_HELP.join('\n'), 'command');

      case '/clear':
        this.memoryStore.clearSession(sessionId);
        return reply('Memoria curta da sessao atual foi limpa.', 'command');

      case '/model': {
        const model = args.join(' ').trim();
        if (!model) {
          return reply('Uso: /model <nome-do-modelo>', 'command');
        }
        this.configStore.setModel(model);
        return reply(`Modelo ativo atualizado para: ${model}`, 'command');
      }

      case '/history': {
        const parsed = parseHistoryArgs(args);
        if (!parsed.ok) {
          return reply(parsed.message, 'command');
        }

        const page = this.modelHistoryService.query({
          page: 1,
          pageSize: parsed.limit,
          operation: parsed.operation,
          status: parsed.status
        });

        return reply(formatHistory(page.items, page.total), 'command');
      }

      case '/mem': {
        const snapshot = this.memoryStore.snapshot();
        return reply(formatMemory(snapshot), 'command');
      }

      case '/whoami': {
        const snapshot = collectEnvironmentSnapshot();
        const sessionPreferredName = resolveSessionPreferredUserName(this.memoryStore.getShortContext(sessionId)) ?? undefined;
        const longMemory = this.memoryStore.getLongMemory();
        return reply(formatWhoAmI(snapshot, longMemory, sessionPreferredName), 'command');
      }

      case '/now': {
        const snapshot = collectEnvironmentSnapshot();
        const sessionPreferredName = resolveSessionPreferredUserName(this.memoryStore.getShortContext(sessionId)) ?? undefined;
        const longMemory = this.memoryStore.getLongMemory();
        return reply(formatNow(snapshot, longMemory, sessionPreferredName), 'command');
      }

      case '/name': {
        const rawName = args.join(' ').trim();
        if (!rawName) {
          return reply('Uso: /name <como devo te chamar>', 'command');
        }

        const patch = buildPreferredUserNamePatch(rawName);
        if (!patch) {
          return reply('Nome invalido. Use ate 4 palavras, sem numeros.', 'command');
        }

        const changed = this.memoryStore.upsertProfileFacts(patch);
        const preferredName = patch.user_display_name;
        if (!preferredName) {
          return reply('Nao consegui atualizar o nome de chamada agora.', 'command');
        }

        if (changed.length === 0) {
          return reply(`Ja estava registrado. Vou te chamar de ${preferredName}.`, 'command');
        }

        return reply(`Perfeito. Vou te chamar de ${preferredName}.`, 'command');
      }

      case '/remember': {
        const note = args.join(' ').trim();
        if (!note) {
          return reply('Uso: /remember <nota-curta>', 'command');
        }
        this.memoryStore.addLongNote(note);
        return reply('Nota salva na memoria de longo prazo.', 'command');
      }

      case '/health': {
        const health = await this.healthService.report();
        return reply(formatHealth(health), 'command');
      }

      case '/env':
      case '/linux': {
        const snapshot = collectEnvironmentSnapshot();
        return reply(formatEnvironmentForCommand(snapshot), 'command');
      }

      case '/doctor': {
        const snapshot = collectEnvironmentSnapshot(true);
        const health = await this.healthService.report();
        const runtime = this.runtimeStatusProvider ? await this.runtimeStatusProvider.status() : null;
        return reply(formatDoctor(snapshot, health, runtime), 'command');
      }

      default:
        return reply('Comando nao reconhecido. Use /help para ver as opcoes.', 'command');
    }
  }
}

function reply(content: string, source: ChatReply['source']): ChatReply {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    source
  };
}

function formatMemory(snapshot: MemorySnapshot): string {
  return [
    'Resumo de memoria:',
    `- Curto prazo (turnos): ${snapshot.shortTermTurns}`,
    `- Medio prazo (sessoes): ${snapshot.mediumTermSessions}`,
    `- Longo prazo (fatos): ${snapshot.longTermFacts}`
  ].join('\n');
}

function formatWhoAmI(snapshot: EnvironmentSnapshot, longMemory: LongTermMemory, sessionPreferredName?: string): string {
  return [
    'Identidade operacional:',
    buildIdentityContext(snapshot, longMemory, sessionPreferredName),
    '',
    'Consciencia situacional:',
    buildSituationalAwarenessContext({
      snapshot,
      longMemory,
      userInFocusOverride: sessionPreferredName
    }),
    '',
    'Protocolos ativos:',
    buildSafetyProtocolContext()
  ].join('\n');
}

function formatNow(snapshot: EnvironmentSnapshot, longMemory: LongTermMemory, sessionPreferredName?: string): string {
  return [
    'Referencia temporal e situacional:',
    buildSituationalAwarenessContext({
      snapshot,
      longMemory,
      userInFocusOverride: sessionPreferredName
    })
  ].join('\n');
}

function formatHealth(health: Awaited<ReturnType<HealthService['report']>>): string {
  const lines = [
    `Saude geral: ${health.ok ? 'OK' : 'ATENCAO'}`,
    `- Ollama: ${health.ollamaReachable ? 'online' : 'offline'}`,
    `- Modelo ativo: ${health.modelAvailable ? 'disponivel' : 'nao encontrado'}`,
    `- Memoria: ${health.memoryHealthy ? 'ok' : 'erro'}`,
    `- Logs: ${health.loggingHealthy ? 'ok' : 'erro'}`
  ];

  if (health.details.length > 0) {
    lines.push('', 'Detalhes:');
    for (const detail of health.details) {
      lines.push(`- ${detail}`);
    }
  }

  return lines.join('\n');
}

function formatDoctor(
  snapshot: EnvironmentSnapshot,
  health: Awaited<ReturnType<HealthService['report']>>,
  runtime: RuntimeStatus | null
): string {
  const lines: string[] = [
    'Diagnostico operacional:',
    `- Coleta: ${snapshot.checkedAt}`,
    `- Host: ${snapshot.hostname} (${snapshot.distro})`,
    `- Usuario: ${snapshot.username}`,
    `- Shell: ${snapshot.shell}`,
    '',
    'Runtime/Health:',
    `- Runtime detectado: ${runtime?.binaryFound ? 'sim' : 'nao'}`,
    `- Runtime online: ${runtime?.ollamaReachable ? 'sim' : 'nao'}`,
    `- Endpoint: ${runtime?.endpoint ?? '--'}`,
    `- Health geral: ${health.ok ? 'OK' : 'ATENCAO'}`,
    `- Modelo ativo: ${health.modelAvailable ? 'disponivel' : 'indisponivel'}`
  ];

  const helper = runtime?.privilegedHelper;
  if (helper) {
    lines.push('', 'Privilegios Linux:');
    lines.push(`- pkexec: ${helper.pkexecAvailable ? 'ok' : 'ausente'} (prompt grafico: ${helper.desktopPrivilegePromptAvailable ? 'ok' : 'ausente'})`);
    lines.push(
      `- sudo: ${helper.sudoAvailable ? 'ok' : 'ausente'} • sudo -n: ${
        helper.sudoNonInteractiveAvailable ? 'ok' : 'indisponivel'
      } • sudo/TTY: ${helper.sudoRequiresTty ? 'requerido' : 'nao'}`
    );
    lines.push(`- Modo operacional do agente: ${helper.agentOperationalMode} (${helper.agentOperationalLevel})`);
    lines.push(`- Status operacional: ${helper.agentOperationalReady ? 'pronto' : 'bloqueado'}`);
    lines.push(`- Motivo: ${helper.agentOperationalReason}`);
  }

  const nextSteps: string[] = [];
  if (runtime && !runtime.binaryFound) {
    nextSteps.push(`Instalar runtime Ollama: ${runtime.suggestedInstallCommand}`);
  } else if (runtime && !runtime.ollamaReachable) {
    nextSteps.push('Iniciar runtime local e revalidar com /health.');
  }

  if (helper && !helper.agentOperationalReady) {
    nextSteps.push('Habilitar caminho de privilegio operacional (pkexec/polkit ou sudo com perfil adequado).');
  } else if (helper && helper.agentOperationalLevel === 'assisted') {
    nextSteps.push('Ambiente em modo assistido: acoes privilegiadas exigem terminal interativo (sudo).');
  }

  if (nextSteps.length > 0) {
    lines.push('', 'Proximos passos:');
    for (const step of nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join('\n');
}

function parseHistoryArgs(
  args: string[]
):
  | {
      ok: true;
      limit: number;
      operation: NonNullable<ModelHistoryQuery['operation']>;
      status: NonNullable<ModelHistoryQuery['status']>;
    }
  | { ok: false; message: string } {
  let limit = 5;
  let operation: NonNullable<ModelHistoryQuery['operation']> = 'all';
  let status: NonNullable<ModelHistoryQuery['status']> = 'all';
  let limitSeen = false;

  for (const rawArg of args) {
    const arg = rawArg.toLowerCase().trim();
    if (/^\d+$/.test(arg)) {
      if (limitSeen) {
        return { ok: false, message: historyUsage() };
      }

      const parsed = Number(arg);
      if (parsed < 1 || parsed > 20) {
        return { ok: false, message: 'Uso: /history [n]. O valor n deve estar entre 1 e 20.' };
      }

      limit = parsed;
      limitSeen = true;
      continue;
    }

    if (arg === 'pull' || arg === 'remove' || arg === 'all') {
      if (operation !== 'all') {
        return { ok: false, message: historyUsage() };
      }

      operation = arg;
      continue;
    }

    if (arg === 'running' || arg === 'done' || arg === 'error' || arg === 'blocked' || arg === 'all') {
      if (status !== 'all') {
        return { ok: false, message: historyUsage() };
      }

      status = arg;
      continue;
    }

    return { ok: false, message: historyUsage() };
  }

  return {
    ok: true,
    limit,
    operation,
    status
  };
}

function formatHistory(items: ModelHistoryRecord[], total: number): string {
  if (total === 0 || items.length === 0) {
    return 'Historico vazio para os filtros informados.';
  }

  const lines = [`Historico de operacoes (mostrando ${items.length} de ${total}):`];
  for (const item of items) {
    const status = historyStatusLabel(item.status);
    const operation = item.operation.toUpperCase();
    const percent = typeof item.percent === 'number' ? ` ${Math.round(item.percent)}%` : '';
    const startedAt = formatDateTime(item.startedAt);
    const duration = item.durationMs !== null ? `, duracao ${formatDuration(item.durationMs)}` : '';
    lines.push(`- [${status}] ${operation} ${item.model}${percent} (${startedAt}${duration})`);
    lines.push(`  ${item.message}`);
  }

  return lines.join('\n');
}

function historyStatusLabel(status: ModelHistoryRecord['status']): string {
  if (status === 'running') {
    return 'EM ANDAMENTO';
  }

  if (status === 'done') {
    return 'CONCLUIDO';
  }

  if (status === 'blocked') {
    return 'BLOQUEADO';
  }

  return 'ERRO';
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return '<1s';
  }

  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
}

function historyUsage(): string {
  return 'Uso: /history [n] [pull|remove] [running|done|error|blocked]. Exemplo: /history 8 pull done';
}
