# Runtime e Modelos

## Objetivo

Dar autonomia ao usuario para diagnosticar runtime local e gerenciar modelos gratuitos pela interface grafica.

O onboarding de setup no inspector ("Primeiros Passos") consome exatamente esses estados de runtime/modelos/health/permissoes para guiar o usuario sem esconder falhas de privilegio.

## Runtime local

- `RuntimeService` detecta binario no PATH e endpoint configurado.
- Em Linux, `RuntimeService.status()` sonda helper/capabilities e matriz de privilegio (`pkexec`, `sudo`, `sudo -n`) para classificar modo operacional do agente: `automated`, `assisted` ou `blocked`.
- `runtime:start` tenta helper privilegiado Linux (`pkexec`) quando disponivel; depois tenta service manager via `sudo -n` (quando elegivel) e por fim fallback para `ollama serve` local.
- Se o endpoint configurado apontar para host remoto, o Dexter nao tenta iniciar runtime local automaticamente (evita comportamento ambiguo e bind incorreto).
- `runtime:install` usa estrategia por ambiente:
  - Linux com helper privilegiado + `pkexec`: tenta helper whitelistado (`install-ollama`) via PolicyKit.
  - Linux: tenta fluxo privilegiado via `pkexec` quando ha prompt grafico disponivel.
  - Linux sem `pkexec`, mas com `sudo`: tenta `sudo -n` (nao interativo).
  - Linux quando `sudo -n` exige TTY/senha: retorna erro orientado (`sudo_tty_required`) com `nextSteps` para terminal interativo.
  - Linux com politica sudo bloqueada para o usuario: retorna erro orientado (`sudo_policy_denied`) e instrucoes administrativas.
  - Linux sem `pkexec`/`sudo`: retorna fluxo assistido (manual no terminal) com `nextSteps`.
  - macOS: tenta comando shell (`brew install ollama`).
  - Windows: retorna orientacao manual (sem automacao nesta fase).
- Durante `runtime:install`, o main emite progresso incremental (`runtimeInstallProgress`) para a UI renderizar barra de progresso de instalacao em tempo real.
- O resultado de instalacao retorna `strategy`, `errorCode`, `manualRequired` e `nextSteps` para a UI mostrar diagnostico acionavel (sem esconder a causa em mensagem generica).
- O diagnostico de instalacao diferencia explicitamente `privilege_required`, `sudo_tty_required`, `sudo_policy_denied`, `timeout` e `command_failed`.
- Em sucesso de instalacao, a UI evita dump tecnico no chat: confirma sucesso de forma curta e tenta auto-iniciar o runtime local (com politica/permissao aplicavel), reduzindo friccao no primeiro setup.
- `DexterBrain` recebe contexto situacional de runtime/modelos via `ConversationContextBuilder`.

## Modelos

- `ModelService` lista modelos instalados via `GET /api/tags`.
- Catalogo curado local destaca modelos recomendados.
- A UI permite baixar (`ollama pull`) e remover (`ollama rm`) sem sair do app.
- `pull/rm` agora fazem preflight antes de executar o CLI:
  - bloqueia quando o endpoint configurado e remoto (evita executar CLI local no host errado)
  - valida se `ollama` existe no PATH local
  - valida se o runtime local responde no endpoint configurado
- Resultado de `pull/rm` retorna `errorCode`, `strategy`, `nextSteps` e `timedOut` para a UI renderizar diagnostico acionavel.
- Download exibe progresso em tempo real no painel lateral, com barra visual e ETA estimado.
- Parsing de progresso do CLI normaliza escapes ANSI e aceita porcentagem decimal (ex.: `0.7%`), reduzindo travamentos perceptivos de telemetria no painel.
- Acao `Aplicar` valida se o modelo existe entre os instalados quando o runtime local esta online, evitando configurar modelo ausente e degradar a UX do chat.
- Historico de operacoes mostra status, horario, duracao e mensagem de cada execucao.
- Historico possui exportacao de auditoria em `json` ou `csv` com filtros aplicados, incluindo periodo.
- Validacao de periodo na UI rejeita datas invalidas (ex.: overflow de calendario como `2026-02-31`) antes da exportacao.
- Logs do Dexter podem ser exportados em `json` ou `csv` direto pela interface, incluindo filtro por periodo.

## Permissoes

- `PermissionService` persiste politicas em disco (`allow|ask|deny`).
- Escopos atuais: `runtime.install`, `tools.filesystem.read`, `tools.filesystem.write`, `tools.system.exec`.
- Acoes sensiveis usam verificacao contextual (`checkPermission`) antes da execucao.
- Importante: permissao `allow` no Dexter nao substitui privilegio do SO. No Linux, instalar Ollama normalmente ainda exige `pkexec` ou `sudo` no host.
- O comando `/doctor` consolida esse diagnostico em linguagem operacional (estado do runtime + modo de privilegio + proximos passos acionaveis).

## Limitacoes atuais

- Instalacao de runtime no Linux normalmente exige privilegios; sem caminho automatizavel (`pkexec`/`sudo -n`) o Dexter cai para fluxo assistido no terminal.
- O Dexter nao coleta senha de `sudo` na UI. Quando o ambiente exigir TTY/terminal para autenticacao, o app retorna `sudo_tty_required` e `nextSteps` objetivos para executar no terminal do sistema.
- Operacoes de modelos (`ollama pull` / `ollama rm`) normalmente nao exigem `sudo`, mas dependem de runtime/endpoint funcionando, binario `ollama` presente no host local e permissao `tools.system.exec`.
- Nomes de modelos no catalogo curado podem evoluir conforme ecossistema Ollama.
- Sistema de update real (GitHub Releases) e opt-in por ambiente; sem configuracao, o Dexter permanece em fallback seguro (`NoopUpdateProvider`).
