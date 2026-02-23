#!/usr/bin/env node

const MODES = ['dev', 'pilot', 'testers', 'stable'];

export function buildRolloutPreset(options) {
  const mode = normalizeMode(options?.mode);
  const repo = typeof options?.repo === 'string' ? options.repo.trim() : '';
  const keyPath = typeof options?.keyPath === 'string' ? options.keyPath.trim() : '';
  const debStrategy = normalizeDebStrategy(options?.debApplyStrategy);

  if (mode !== 'dev' && !isValidRepoSpec(repo)) {
    throw new Error('Modo exige --repo no formato <owner>/<repo>.');
  }

  const env = {};

  if (mode === 'dev') {
    env.DEXTER_UPDATE_PROVIDER = 'none';
    env.DEXTER_UPDATE_DEB_APPLY_STRATEGY = 'assist';
    env.DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE = '0';
    env.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE = '0';
    env.DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS = '15000';
    env.DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS = '0';
    return {
      mode,
      env,
      notes: [
        'Preset local de desenvolvimento (update remoto desativado).',
        'Use DEXTER_MOCK_API=1 para validar UI/fluxos sem provider real.'
      ]
    };
  }

  env.DEXTER_UPDATE_PROVIDER = 'github';
  env.DEXTER_UPDATE_GITHUB_REPO = repo;
  if (keyPath) {
    env.DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH = keyPath;
  }

  if (mode === 'pilot') {
    env.DEXTER_UPDATE_DEB_APPLY_STRATEGY = debStrategy ?? 'pkexec-apt';
    env.DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE = '1';
    env.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE = '1';
    env.DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS = '15000';
    env.DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS = '5000';
  } else if (mode === 'testers') {
    env.DEXTER_UPDATE_DEB_APPLY_STRATEGY = debStrategy ?? 'assist';
    env.DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE = '0';
    env.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE = '1';
    env.DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS = '20000';
    env.DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS = '8000';
  } else {
    env.DEXTER_UPDATE_DEB_APPLY_STRATEGY = debStrategy ?? 'assist';
    env.DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE = '0';
    env.DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE = '1';
    env.DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS = '15000';
    env.DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS = '5000';
  }

  const notes = [
    `Preset '${mode}' aplicado para provider GitHub.`,
    keyPath
      ? 'Verificacao de assinatura de manifesto ativada por chave publica via PATH.'
      : 'Defina --key-path para ativar verificacao de assinatura de manifesto no app.'
  ];

  return {
    mode,
    env,
    notes
  };
}

export function buildPilotVerifyEnvFromPreset(preset, options) {
  const mode = normalizeMode(preset?.mode);
  if (mode === 'dev') {
    return null;
  }

  const env = {
    DEXTER_UPDATE_GITHUB_REPO: preset.env.DEXTER_UPDATE_GITHUB_REPO
  };
  if (typeof options?.channel === 'string' && options.channel.trim()) {
    env.DEXTER_UPDATE_CHANNEL = options.channel.trim() === 'rc' ? 'rc' : 'stable';
  } else if (mode === 'pilot') {
    env.DEXTER_UPDATE_CHANNEL = 'rc';
  } else {
    env.DEXTER_UPDATE_CHANNEL = 'stable';
  }

  env.DEXTER_UPDATE_VERIFY_DOWNLOAD = '1';
  if (preset.env.DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH) {
    env.DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH = preset.env.DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH;
    env.DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST = '1';
  }

  return env;
}

export function formatShellExports(env, options = {}) {
  const lines = [];
  if (options.header) {
    lines.push(`# ${options.header}`);
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') {
      continue;
    }
    lines.push(`export ${key}=${shellQuote(value)}`);
  }

  if (Array.isArray(options.notes)) {
    for (const note of options.notes) {
      lines.push(`# ${note}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv) {
  const result = {
    mode: 'dev',
    repo: '',
    keyPath: '',
    debApplyStrategy: '',
    includeVerify: false,
    verifyChannel: '',
    format: 'shell',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--include-verify') {
      result.includeVerify = true;
      continue;
    }
    if (arg === '--mode' || arg === '--repo' || arg === '--key-path' || arg === '--deb-strategy' || arg === '--verify-channel' || arg === '--format') {
      const value = argv[index + 1];
      if (typeof value !== 'string') {
        throw new Error(`Valor ausente para ${arg}`);
      }
      index += 1;
      if (arg === '--mode') {
        result.mode = value;
      } else if (arg === '--repo') {
        result.repo = value;
      } else if (arg === '--key-path') {
        result.keyPath = value;
      } else if (arg === '--deb-strategy') {
        result.debApplyStrategy = value;
      } else if (arg === '--verify-channel') {
        result.verifyChannel = value;
      } else if (arg === '--format') {
        result.format = value;
      }
      continue;
    }

    throw new Error(`Argumento nao suportado: ${arg}`);
  }

  return result;
}

export function runRolloutPresetCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  const preset = buildRolloutPreset({
    mode: args.mode,
    repo: args.repo,
    keyPath: args.keyPath,
    debApplyStrategy: args.debApplyStrategy
  });

  const format = args.format === 'json' ? 'json' : 'shell';
  if (format === 'json') {
    const payload = {
      mode: preset.mode,
      appEnv: preset.env,
      verifyEnv: args.includeVerify ? buildPilotVerifyEnvFromPreset(preset, { channel: args.verifyChannel }) : null,
      notes: preset.notes
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    formatShellExports(preset.env, {
      header: `Dexter rollout preset (${preset.mode}) - app`,
      notes: preset.notes
    })
  );

  if (args.includeVerify) {
    const verifyEnv = buildPilotVerifyEnvFromPreset(preset, {
      channel: args.verifyChannel
    });
    if (verifyEnv) {
      process.stdout.write('\n');
      process.stdout.write(
        formatShellExports(verifyEnv, {
          header: `Dexter rollout preset (${preset.mode}) - update:pilot:verify`
        })
      );
    }
  }

  return 0;
}

function normalizeMode(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : 'dev';
  if (MODES.includes(raw)) {
    return raw;
  }
  throw new Error(`Modo invalido: ${value}. Use um de: ${MODES.join(', ')}`);
}

function normalizeDebStrategy(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const raw = value.trim().toLowerCase();
  if (raw === 'assist' || raw === 'pkexec-apt') {
    return raw;
  }
  throw new Error('Deb strategy invalida. Use assist ou pkexec-apt.');
}

function isValidRepoSpec(value) {
  const parts = value.split('/');
  return parts.length === 2 && parts[0].trim().length > 0 && parts[1].trim().length > 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function helpText() {
  return `Uso: node scripts/update-rollout-presets.mjs --mode <dev|pilot|testers|stable> [opcoes]

Gera presets de variaveis de ambiente para rollout do modulo de update.

Opcoes:
  --mode <modo>            dev | pilot | testers | stable
  --repo <owner/repo>      Obrigatorio para modos nao-dev
  --key-path <arquivo.pem> Chave publica para verificacao de assinatura do manifesto
  --deb-strategy <valor>   assist | pkexec-apt (override do preset)
  --include-verify         Tambem imprime envs para \`npm run update:pilot:verify\`
  --verify-channel <canal> stable | rc (override da verificacao)
  --format <shell|json>    Formato de saida (default: shell)
  --help                   Mostra esta ajuda

Exemplos:
  eval "$(npm run update:rollout:preset -- --mode pilot --repo N1ghthill/dexter --key-path /path/public.pem)"
  npm run update:rollout:preset -- --mode stable --repo N1ghthill/dexter --key-path /path/public.pem --include-verify
`;
}

const isDirectRun = typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1]?.endsWith('update-rollout-presets.mjs');
if (isDirectRun) {
  try {
    const code = runRolloutPresetCli();
    process.exitCode = code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Erro: ${message}\n\n${helpText()}`);
    process.exitCode = 1;
  }
}

