import { describe, expect, it } from 'vitest';
import {
  buildPreferredUserNamePatch,
  buildIdentityContext,
  buildIdentityProfilePatch,
  buildSafetyProtocolContext,
  extractPreferredUserName,
  resolveSessionPreferredUserName,
  readRememberedUserName
} from '@main/services/agent/agent-consciousness';
import type { LongTermMemory } from '@shared/contracts';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';

describe('agent-consciousness', () => {
  it('extrai nome preferido informado pelo usuario', () => {
    expect(extractPreferredUserName('Meu nome é irving.')).toBe('Irving');
    expect(extractPreferredUserName('pode me chamar de maria clara')).toBe('Maria Clara');
    expect(extractPreferredUserName('texto sem nome')).toBeNull();
  });

  it('monta patch de perfil e contexto de identidade com dados locais', () => {
    const snapshot = fakeSnapshot();
    const patch = buildIdentityProfilePatch(snapshot);
    expect(patch.assistant_name).toBe('Dexter');
    expect(patch.local_username).toBe('irving');
    expect(patch.user_display_name).toBeUndefined();

    const longMemory: LongTermMemory = {
      profile: patch,
      preferences: {},
      notes: []
    };
    const context = buildIdentityContext(snapshot, longMemory);
    expect(context).toContain('Assistente: Dexter');
    expect(context).toContain('Usuario em foco da sessao: Irving');
    expect(context).toContain('Usuario lembrado: Irving');
    expect(context).toContain('/opt/Dexter/dexter');
  });

  it('explicita protocolo operacional de seguranca', () => {
    const protocol = buildSafetyProtocolContext();
    expect(protocol).toContain('Nao alegue que executou comandos');
    expect(protocol).toContain('escrita/exclusao/sobrescrita');
  });

  it('usa fallback para usuario lembrado quando nao ha nome preferido', () => {
    const longMemory: LongTermMemory = {
      profile: {
        local_username: 'irving'
      },
      preferences: {},
      notes: []
    };

    expect(readRememberedUserName(longMemory)).toBe('Irving');
  });

  it('gera patch explicito de nome preferido quando valido', () => {
    expect(buildPreferredUserNamePatch('maria clara')).toEqual({
      user_display_name: 'Maria Clara'
    });
    expect(buildPreferredUserNamePatch('maria 123')).toBeNull();
  });

  it('resolve nome preferido com escopo de sessao usando contexto recente', () => {
    const preferred = resolveSessionPreferredUserName(
      [
        {
          id: 'u1',
          role: 'user',
          content: 'oi',
          timestamp: new Date().toISOString()
        },
        {
          id: 'u2',
          role: 'user',
          content: 'me chama de ana paula',
          timestamp: new Date().toISOString()
        }
      ],
      ''
    );

    expect(preferred).toBe('Ana Paula');
  });
});

function fakeSnapshot(): EnvironmentSnapshot {
  return {
    checkedAt: new Date().toISOString(),
    platform: 'linux',
    release: '6.8.0',
    arch: 'x64',
    distro: 'Ubuntu 24.04',
    hostname: 'devbox',
    username: 'irving',
    shell: '/bin/bash',
    uptimeSeconds: 1200,
    installMode: 'packaged',
    execPath: '/opt/Dexter/dexter',
    resourcesPath: '/opt/Dexter/resources',
    commands: [],
    notes: []
  };
}
