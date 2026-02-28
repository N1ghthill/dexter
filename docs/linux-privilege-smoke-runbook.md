# Runbook de Smoke: Matriz de Privilegios Linux

## Objetivo

Validar em host Linux real que o Dexter detecta corretamente o caminho de privilegio operacional e apresenta onboarding coerente (`Pronto`, `Assistido`, `Limitado`) sem mensagens ambiguas.

## Precondicoes

1. Build recente instalado (`.deb`/`AppImage`) ou `npm run dev`.
2. Ollama nao obrigatoriamente instalado no inicio (o fluxo cobre setup).
3. Acesso ao terminal local para validar comandos de ambiente.

## Comandos de baseline

Execute no host antes de abrir o Dexter:

```bash
which pkexec || true
which sudo || true
sudo -n true; echo "sudo-n exit=$?"
echo "DISPLAY=${DISPLAY:-}" "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}" "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-}"
```

Depois, no chat do Dexter:

```text
/doctor
/health
```

## Cenario A: `pkexec` automatizado (esperado: `Pronto`)

Condicoes:
- `pkexec` disponivel
- prompt grafico/polkit disponivel

Verificacoes:
1. `/doctor` mostra `Modo operacional do agente: pkexec (automated)`.
2. Setup completo com runtime online + modelo + health.
3. Badge do onboarding em `Configuracoes > Setup`: `Pronto`.

## Cenario B: `sudo -n` automatizado (esperado: `Pronto`)

Condicoes:
- sem `pkexec` funcional
- `sudo -n true` retorna `exit=0` (NOPASSWD)

Verificacoes:
1. `/doctor` mostra `sudo -n: ok`.
2. Instalacao de runtime usa estrategia `linux/sudo-noninteractive`.
3. Setup completo termina em badge `Pronto`.

## Cenario C: `sudo` interativo (esperado: `Assistido`)

Condicoes:
- `sudo` disponivel
- `sudo -n true` falha por TTY/senha (nao por politica)

Verificacoes:
1. `/doctor` mostra `Modo operacional do agente: sudo-terminal (assisted)`.
2. Instalacao automatica retorna diagnostico (`sudo_tty_required`) com `nextSteps` para terminal.
3. Com setup concluido via terminal + revalidacao, badge fica `Assistido`.

## Cenario D: sem caminho de privilegio (esperado: `Limitado`)

Condicoes:
- sem `pkexec` utilizavel
- sem `sudo` ou politica sudo bloqueada para o usuario

Verificacoes:
1. `/doctor` mostra `Status operacional: bloqueado`.
2. Setup pode ficar funcional para chat/runtime existente, mas o onboarding marca `Limitado`.
3. A UI orienta proximo passo administrativo (sem tentar shell root interno).

## Evidencias minimas por cenario

1. Captura do `/doctor` no chat.
2. Captura do badge em `Primeiros Passos`.
3. Trecho do log exportado (`logs: ui`) com evento `setup.repair.finish` quando reparo for testado.

## Criterio de aprovacao

- Sem mensagens genericas de erro de privilegio.
- Proximo passo sempre acionavel e consistente com o ambiente.
- Nenhum caminho executa shell privilegiado arbitrario controlado pela UI.
