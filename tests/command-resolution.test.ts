import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('command-resolution', () => {
  it('normaliza PATH com diretórios padrão no Linux', async () => {
    const setup = await loadCommandResolutionModule();
    const env = setup.buildCommandEnvironment('linux', {
      PATH: '/custom/bin',
      HOME: '/tmp/user'
    });

    expect(env.PATH).toContain('/custom/bin');
    expect(env.PATH).toContain('/usr/bin');
    expect(env.PATH).toContain('/usr/local/bin');
    expect(env.HOME).toBe('/tmp/user');
  });

  it('resolve binário pelo resolver do sistema quando disponível', async () => {
    const setup = await loadCommandResolutionModule();
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/local/bin/ollama\n'
    });

    const result = setup.resolveCommandBinary('ollama', 'linux');

    expect(result).toEqual({
      found: true,
      path: '/usr/local/bin/ollama'
    });
    expect(setup.spawnSync).toHaveBeenCalledWith('which', ['ollama'], expect.anything());
  });

  it('usa fallback de caminhos comuns quando resolver falha', async () => {
    const setup = await loadCommandResolutionModule();
    setup.spawnSync.mockImplementation(() => {
      throw new Error('which indisponivel');
    });
    setup.existsSync.mockImplementation((candidate: string) => candidate === '/usr/bin/ollama');

    const result = setup.resolveCommandBinary('ollama', 'linux');

    expect(result).toEqual({
      found: true,
      path: '/usr/bin/ollama'
    });
  });

  it('aceita caminho absoluto quando arquivo existe', async () => {
    const setup = await loadCommandResolutionModule();
    setup.existsSync.mockImplementation((candidate: string) => candidate === '/opt/ollama/bin/ollama');

    const result = setup.resolveCommandBinary('/opt/ollama/bin/ollama', 'linux');

    expect(result).toEqual({
      found: true,
      path: '/opt/ollama/bin/ollama'
    });
    expect(setup.spawnSync).not.toHaveBeenCalled();
  });
});

async function loadCommandResolutionModule(): Promise<{
  buildCommandEnvironment: any;
  resolveCommandBinary: any;
  spawnSync: ReturnType<typeof vi.fn>;
  existsSync: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const spawnSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(false);

  vi.doMock('node:child_process', () => ({
    spawnSync
  }));

  vi.doMock('node:fs', () => ({
    existsSync
  }));

  const mod = await import('@main/services/environment/command-resolution');

  return {
    buildCommandEnvironment: mod.buildCommandEnvironment,
    resolveCommandBinary: mod.resolveCommandBinary,
    spawnSync,
    existsSync
  };
}
