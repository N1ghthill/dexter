import fs from 'node:fs';
import os from 'node:os';
import { resolveCommandBinary } from '@main/services/environment/command-resolution';

interface CommandProbe {
  command: string;
  available: boolean;
  path: string | null;
}

export interface EnvironmentSnapshot {
  checkedAt: string;
  platform: NodeJS.Platform;
  release: string;
  arch: string;
  distro: string;
  hostname: string;
  username: string;
  shell: string;
  uptimeSeconds: number;
  commands: CommandProbe[];
  notes: string[];
}

const COMMANDS_TO_PROBE = ['ollama', 'systemctl', 'journalctl', 'curl', 'git', 'bash'] as const;
const SNAPSHOT_TTL_MS = 15000;

let cachedSnapshot: EnvironmentSnapshot | null = null;
let cachedUntil = 0;

export function collectEnvironmentSnapshot(force = false): EnvironmentSnapshot {
  const now = Date.now();
  if (!force && cachedSnapshot && now < cachedUntil) {
    return cachedSnapshot;
  }

  const platform = process.platform;
  const notes: string[] = [];

  if (platform !== 'linux') {
    notes.push('Runtime fora de Linux: alguns comandos e automacoes podem variar.');
  }

  const snapshot: EnvironmentSnapshot = {
    checkedAt: new Date().toISOString(),
    platform,
    release: os.release(),
    arch: os.arch(),
    distro: detectDistro(),
    hostname: os.hostname(),
    username: detectUsername(),
    shell: detectShell(),
    uptimeSeconds: Math.max(0, Math.floor(os.uptime())),
    commands: COMMANDS_TO_PROBE.map((command) => probeCommand(command)),
    notes
  };

  cachedSnapshot = snapshot;
  cachedUntil = now + SNAPSHOT_TTL_MS;
  return snapshot;
}

export function formatEnvironmentForCommand(snapshot: EnvironmentSnapshot): string {
  const available = snapshot.commands.filter((item) => item.available);
  const unavailable = snapshot.commands.filter((item) => !item.available);

  const availableText =
    available.length > 0
      ? available.map((item) => (item.path ? `${item.command} (${item.path})` : item.command)).join(', ')
      : 'nenhum comando principal detectado';

  const unavailableText = unavailable.length > 0 ? unavailable.map((item) => item.command).join(', ') : 'nenhum';
  const noteText = snapshot.notes.length > 0 ? snapshot.notes.join(' ') : 'Nenhum alerta relevante.';

  return [
    'Ambiente local:',
    `- SO: ${snapshot.distro} (${snapshot.platform} ${snapshot.release}, ${snapshot.arch})`,
    `- Host: ${snapshot.hostname}`,
    `- Usuario: ${snapshot.username}`,
    `- Shell: ${snapshot.shell}`,
    `- Uptime: ${formatDuration(snapshot.uptimeSeconds)}`,
    `- Comandos disponiveis: ${availableText}`,
    `- Comandos ausentes: ${unavailableText}`,
    `- Notas: ${noteText}`,
    '',
    'Use /health para validar runtime/modelo e /history para revisar operacoes.'
  ].join('\n');
}

export function formatEnvironmentForPrompt(snapshot: EnvironmentSnapshot): string {
  const available = snapshot.commands
    .filter((item) => item.available)
    .map((item) => item.command)
    .join(', ');

  const importantMissing = snapshot.commands
    .filter((item) => !item.available && (item.command === 'ollama' || item.command === 'systemctl'))
    .map((item) => item.command);

  const notes = [...snapshot.notes];
  if (importantMissing.length > 0) {
    notes.push(`Comandos ausentes importantes: ${importantMissing.join(', ')}.`);
  }

  return [
    `SO: ${snapshot.distro} (${snapshot.platform} ${snapshot.release}, ${snapshot.arch})`,
    `Host: ${snapshot.hostname}`,
    `Usuario: ${snapshot.username}`,
    `Shell: ${snapshot.shell}`,
    `Uptime: ${formatDuration(snapshot.uptimeSeconds)}`,
    `Comandos disponiveis: ${available || 'nenhum'}`,
    `Observacoes: ${notes.length > 0 ? notes.join(' ') : 'sem alertas'}`
  ].join('\n');
}

function detectDistro(): string {
  if (process.platform !== 'linux') {
    return os.type();
  }

  const filePath = '/etc/os-release';
  if (!fs.existsSync(filePath)) {
    return 'Linux';
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const pairs = parseEnvLikeFile(raw);
    if (pairs.PRETTY_NAME) {
      return pairs.PRETTY_NAME;
    }

    const named = [pairs.NAME, pairs.VERSION].filter((value): value is string => Boolean(value)).join(' ');
    return named || 'Linux';
  } catch {
    return 'Linux';
  }
}

function detectUsername(): string {
  try {
    return os.userInfo().username || process.env.USER || 'desconhecido';
  } catch {
    return process.env.USER || 'desconhecido';
  }
}

function detectShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd';
  }

  return process.env.SHELL || 'shell-nao-detectado';
}

function probeCommand(command: string): CommandProbe {
  const resolved = resolveCommandBinary(command, process.platform);
  return {
    command,
    available: resolved.found,
    path: resolved.path
  };
}

function parseEnvLikeFile(raw: string): Record<string, string> {
  const output: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    output[key] = stripWrappingQuotes(value);
  }

  return output;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours}h ${remMinutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}
