# Onboarding Linux (Setup Guiado)

## Objetivo

Garantir que o usuario consiga instalar, iniciar e validar o Dexter com o minimo de friccao, mesmo quando a automacao completa nao for possivel no host.

## Fluxo alvo (setup minimo)

1. Detectar runtime (`ollama` no PATH)
2. Instalar runtime (GUI com `pkexec` quando possivel; fallback assistido)
3. Iniciar runtime local
4. Baixar primeiro modelo local
5. Validar `health` (runtime + modelo + componentes locais)

## Estado atual (UI implementada)

- Card "Primeiros Passos" no topo do inspector com:
  - badge de estado (`Detectando`, `Instalar`, `Iniciar`, `Baixar Modelo`, `Validar`, `Assistido`, `Limitado`, `Pronto`)
  - checklist de etapas
  - CTA primario contextual
  - CTA secundario (ex.: copiar comando de instalacao, rodar health, reparar setup)
  - nota explicita sobre permissao do Dexter vs privilegio do SO
- Em Linux, `RuntimeService` ja tenta helper privilegiado whitelistado via `pkexec` (quando o script bundlado existe em build empacotada e o ambiente suporta prompt grafico) antes de cair nos fallbacks.
- Quando `pkexec` nao esta disponivel, o `RuntimeService` tenta `sudo -n` e classifica o resultado (`automated`, `assisted`, `blocked`) para o onboarding nao mascarar restricoes reais.
- O painel Runtime e o onboarding tambem exibem diagnostico de capabilities do helper (`systemctl`/`service`/`curl`) quando a sonda local do helper estiver disponivel.
- O painel Runtime tambem exibe diagnostico de `pkexec`, `sudo`, `sudo -n`, necessidade de TTY e politica sudo, com hint de fallback para fluxo manual.
- A instalacao de runtime exibe barra de progresso dedicada no card `Runtime Local` (evento IPC de progresso), reduzindo incerteza durante downloads longos.
- Ao concluir a instalacao com sucesso, a UI tenta iniciar o runtime automaticamente (quando endpoint local + permissao `tools.system.exec`), para evitar etapa manual surpresa no setup.
- Detalhes avancados do helper/ambiente ficam em bloco expansivel no card `Runtime Local` (aberto automaticamente quando ha limitacoes relevantes).
- A preferencia aberto/fechado desse bloco de detalhes e persistida localmente na UI entre recargas.
- O card `Runtime Local` possui acao explicita de `Reparar/Reiniciar Runtime` (se endpoint local + binario presente), reutilizando o mesmo fluxo seguro de reparo.
- O card `Saude` pode expor CTA `Reparar Setup` quando houver alertas, reutilizando o orquestrador de reparo/validacao.

## Matriz de degradacao elegante

### Sem `ollama` no PATH

- CTA: `Instalar Runtime`
- Se `runtime.install=deny`: CTA vira `Revisar Permissoes`
- CTA secundario: `Copiar Comando`
- Nota: Linux tenta `pkexec` -> `sudo -n` -> terminal `sudo` (assistido)

### Runtime instalado, mas offline

- CTA: `Iniciar Runtime`
- Se `tools.system.exec=deny`: CTA vira `Revisar Permissoes`
- CTA secundario: `Reparar Setup` quando o endpoint e local e `tools.system.exec` permite execucao (senao `Rodar Health`)
- `Reparar Setup`: tenta reparar/reiniciar runtime (helper privilegiado quando disponivel, com fallback seguro) e depois valida `runtimeStatus` + `health`

### Runtime online, sem modelos

- CTA: `Baixar Modelo`
- Se `tools.system.exec=deny`: CTA vira `Revisar Permissoes`
- CTA secundario: `Rodar Health`

### Modelo instalado, mas modelo ativo invalido

- CTA: `Usar Modelo Instalado`
- CTA secundario: `Rodar Health`

### Setup concluido

- Sem restricao de privilegio: badge `Pronto`
- Com privilegio apenas via terminal: badge `Assistido`
- Sem caminho de privilegio (`pkexec/sudo`): badge `Limitado`
- CTA principal: `Ajuda Rapida` (ou `Copiar Comando` no modo `Limitado`)
- CTA secundario: `Rodar Health`

## Regras de UX

- Mostrar causa real antes da acao (permissao Dexter, runtime offline, modelo ausente).
- Nao ocultar falhas de privilegio do SO; transformar em `nextSteps` claros.
- Nao afirmar sucesso sem validacao (`runtimeStatus` / `health`).
- Reaproveitar botoes/acoes reais do painel (sem logica duplicada no renderer).
- Quando houver reparo guiado, consolidar o resultado em uma mensagem com: runtime, helper (se houver), health e proximo passo.
- O card `Runtime Local` e o onboarding podem oferecer acoes complementares (`Reparar Runtime` vs `Reparar Setup`) sem duplicar logica de backend.
- O card `Saude` pode reutilizar `Reparar Setup` para troubleshooting rapido sem obrigar o usuario a navegar pelo onboarding.
- Registrar auditoria local de `Reparar Setup` (origem, resultado e proximo passo sugerido) nos logs exportaveis do Dexter.
- O painel `Governanca` inclui `Uninstall` assistido com token de confirmacao e escopos opcionais (dados locais/runtime), reutilizando a mesma matriz de privilegio Linux do runtime.
- A exportacao de logs pode filtrar rapidamente apenas auditoria de UI (`logs: ui` / atalho `Logs de UI`), com um clique usando o periodo atualmente selecionado.

## Criterios minimos de aceitacao

- Chat permanece utilizavel (scroll funcional, CTA visivel, sem overflow grave).
- Usuario entende o proximo passo em ate uma leitura do card de setup.
- Falha de instalacao no Linux diferencia:
  - bloqueio de permissao do Dexter
  - falta de privilegio do SO (`pkexec`/`sudo`)
  - `sudo_tty_required` (sudo exige terminal interativo)
  - `sudo_policy_denied` (usuario sem permissao sudo)
  - falha de comando / timeout

## Evolucao recomendada

1. Expandir helper privilegiado (polkit) com `status`/`stop`/`restart`/reparo guiado (whitelist).
2. Diagnostico guiado de service manager (systemd / processo local).
3. "Reparar setup" com acoes whitelistadas e trilha de auditoria.
