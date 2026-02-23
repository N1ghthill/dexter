import { describe, expect, it } from 'vitest';

describe('update-rollout-presets script', () => {
  it('gera preset dev com provider none', async () => {
    const { buildRolloutPreset } = await loadScript();

    const preset = buildRolloutPreset({
      mode: 'dev'
    });

    expect(preset.mode).toBe('dev');
    expect(preset.env.DEXTER_UPDATE_PROVIDER).toBe('none');
    expect(preset.env.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE).toBe('0');
  });

  it('gera preset pilot com rollback opt-in e handshake/stability', async () => {
    const { buildRolloutPreset, buildPilotVerifyEnvFromPreset } = await loadScript();

    const preset = buildRolloutPreset({
      mode: 'pilot',
      repo: 'N1ghthill/dexter',
      keyPath: '/tmp/public.pem'
    });

    expect(preset.env.DEXTER_UPDATE_PROVIDER).toBe('github');
    expect(preset.env.DEXTER_UPDATE_GITHUB_REPO).toBe('N1ghthill/dexter');
    expect(preset.env.DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE).toBe('1');
    expect(preset.env.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE).toBe('1');
    expect(preset.env.DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS).toBe('5000');

    const verifyEnv = buildPilotVerifyEnvFromPreset(preset);
    expect(verifyEnv?.DEXTER_UPDATE_CHANNEL).toBe('rc');
    expect(verifyEnv?.DEXTER_UPDATE_VERIFY_DOWNLOAD).toBe('1');
    expect(verifyEnv?.DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST).toBe('1');
  });

  it('formata shell exports e falha sem repo em modo nao-dev', async () => {
    const { buildRolloutPreset, formatShellExports } = await loadScript();

    expect(() => buildRolloutPreset({ mode: 'stable' })).toThrow(/--repo/);

    const preset = buildRolloutPreset({
      mode: 'stable',
      repo: 'N1ghthill/dexter'
    });
    const shell = formatShellExports(preset.env, { header: 'teste' });

    expect(shell).toContain('# teste');
    expect(shell).toContain("export DEXTER_UPDATE_PROVIDER='github'");
    expect(shell).toContain("export DEXTER_UPDATE_GITHUB_REPO='N1ghthill/dexter'");
  });

  it('CLI suporta saida JSON com include-verify', async () => {
    const { runRolloutPresetCli } = await loadScript();
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      writes.push(String(chunk));
      return true;
    }) as any;
    try {
      const code = runRolloutPresetCli([
        '--mode',
        'testers',
        '--repo',
        'N1ghthill/dexter',
        '--key-path',
        '/tmp/public.pem',
        '--include-verify',
        '--format',
        'json'
      ]);

      expect(code).toBe(0);
      const payload = JSON.parse(writes.join(''));
      expect(payload.mode).toBe('testers');
      expect(payload.appEnv.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE).toBe('1');
      expect(payload.verifyEnv.DEXTER_UPDATE_CHANNEL).toBe('stable');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

async function loadScript(): Promise<any> {
  const modulePath: string = '../scripts/update-rollout-presets.mjs';
  return import(modulePath);
}
