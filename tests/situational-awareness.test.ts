import { describe, expect, it } from 'vitest';
import { buildSituationalAwarenessContext } from '@main/services/agent/situational-awareness';
import type { LongTermMemory } from '@shared/contracts';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';

describe('situational-awareness', () => {
  it('gera contexto temporal e situacional com dados locais reais', () => {
    const context = buildSituationalAwarenessContext({
      snapshot: fakeSnapshot(),
      longMemory: fakeLongMemory(),
      now: new Date('2026-02-24T23:00:00.000Z'),
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
      workingDirectory: '/home/irving/ruas/repos/dexter'
    });

    expect(context).toContain('Agora local:');
    expect(context).toContain('Dia da semana local:');
    expect(context).toContain('Fuso horario local: America/Sao_Paulo');
    expect(context).toContain('Momento UTC: 2026-02-24T23:00:00.000Z');
    expect(context).toContain('Usuario em foco: Irving');
    expect(context).toContain('Sistema: Ubuntu 24.04 (linux 6.8.0, x64)');
    expect(context).toContain('Diretorio de trabalho do processo: /home/irving/ruas/repos/dexter');
  });

  it('usa usuario do sistema quando nao ha nome lembrado', () => {
    const context = buildSituationalAwarenessContext({
      snapshot: fakeSnapshot(),
      longMemory: {
        profile: {},
        preferences: {},
        notes: []
      }
    });

    expect(context).toContain('Usuario em foco: irving');
  });
});

function fakeSnapshot(): EnvironmentSnapshot {
  return {
    checkedAt: '2026-02-24T22:59:30.000Z',
    platform: 'linux',
    release: '6.8.0',
    arch: 'x64',
    distro: 'Ubuntu 24.04',
    hostname: 'devbox',
    username: 'irving',
    shell: '/bin/bash',
    uptimeSeconds: 1800,
    installMode: 'packaged',
    execPath: '/opt/Dexter/dexter',
    resourcesPath: '/opt/Dexter/resources',
    commands: [],
    notes: []
  };
}

function fakeLongMemory(): LongTermMemory {
  return {
    profile: {
      user_display_name: 'Irving'
    },
    preferences: {},
    notes: []
  };
}
