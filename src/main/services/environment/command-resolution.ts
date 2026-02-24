import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface CommandResolution {
  found: boolean;
  path: string | null;
}

const DEFAULT_PATH_SEGMENTS: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin', '/snap/bin'],
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'],
  win32: []
} as const;

export function buildCommandEnvironment(
  platform: NodeJS.Platform = process.platform,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const normalizedPath = normalizePathEnv(platform, baseEnv.PATH);
  if (normalizedPath) {
    env.PATH = normalizedPath;
  }
  return env;
}

export function resolveCommandBinary(commandName: string, platform: NodeJS.Platform = process.platform): CommandResolution {
  const normalized = commandName.trim();
  if (!normalized) {
    return {
      found: false,
      path: null
    };
  }

  if (path.isAbsolute(normalized) && existsSync(normalized)) {
    return {
      found: true,
      path: normalized
    };
  }

  const env = buildCommandEnvironment(platform);
  const resolver = platform === 'win32' ? 'where' : 'which';

  try {
    const result = spawnSync(resolver, [normalized], {
      encoding: 'utf-8',
      env
    });
    if (result.status === 0) {
      const firstLine = readFirstOutputLine(result.stdout);
      if (firstLine) {
        return {
          found: true,
          path: firstLine
        };
      }
    }
  } catch {
    // fallback manual abaixo
  }

  const fallback = resolveFromCommonPaths(normalized, platform, env.PATH);
  if (fallback) {
    return {
      found: true,
      path: fallback
    };
  }

  return {
    found: false,
    path: null
  };
}

function normalizePathEnv(platform: NodeJS.Platform, currentPath: string | undefined): string {
  const entries = splitPathEntries(currentPath);
  for (const fallback of getDefaultPathSegments(platform)) {
    if (!containsPathEntry(entries, fallback, platform)) {
      entries.push(fallback);
    }
  }
  return entries.join(path.delimiter);
}

function splitPathEntries(value: string | undefined): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function containsPathEntry(entries: string[], candidate: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    const normalizedCandidate = candidate.toLowerCase();
    return entries.some((entry) => entry.toLowerCase() === normalizedCandidate);
  }
  return entries.includes(candidate);
}

function resolveFromCommonPaths(
  commandName: string,
  platform: NodeJS.Platform,
  currentPath: string | undefined
): string | null {
  if (platform === 'win32') {
    return null;
  }

  const pathEntries = splitPathEntries(currentPath);
  const candidates = [...pathEntries, ...getDefaultPathSegments(platform)];
  for (const dir of candidates) {
    const target = path.join(dir, commandName);
    if (existsSync(target)) {
      return target;
    }
  }

  return null;
}

function getDefaultPathSegments(platform: NodeJS.Platform): string[] {
  return DEFAULT_PATH_SEGMENTS[platform] ?? [];
}

function readFirstOutputLine(output: string | Buffer | null | undefined): string | null {
  if (typeof output !== 'string') {
    return null;
  }

  const firstLine = output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ?? null;
}
