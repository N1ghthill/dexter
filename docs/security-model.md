# Modelo de Seguranca (Renderer, Main e Privilegios)

## Objetivo

Permitir "integracao total" no Dexter sem misturar UX rica com execucao privilegiada arbitraria.

## Principios

- `renderer` nunca executa comandos de sistema diretamente.
- `preload` expoe apenas contratos IPC explicitos e tipados.
- `main` orquestra e valida acoes; nao repassa shell arbitrario vindo da UI.
- Permissao interna do Dexter (`allow|ask|deny`) nao substitui privilegio do SO (`pkexec`/`sudo`).
- Toda acao sensivel deve retornar diagnostico acionavel (`errorCode`, `nextSteps`, contexto).

## Fronteiras de responsabilidade

### Renderer (UI)

- Coleta intencao do usuario.
- Mostra onboarding, checklist, estados e erros.
- Faz confirmacao de acoes via `checkPermission`.
- Nao coleta senha de `sudo` e nao embute terminal root.

### Preload (ponte)

- Traduz chamadas da UI para IPC.
- Mantem superficie minima (`window.dexter.*`).

### Main + Services

- Valida permissao interna.
- Executa fluxo seguro por dominio (`runtime`, `models`, `updates`).
- Registra logs e historico de operacoes.
- Degrada com fluxo assistido quando o ambiente nao suporta automacao segura (ex.: sem `pkexec`).

## Duas camadas de autorizacao

1. Autorizacao do Dexter
- Controlada por `PermissionService`.
- Escopos atuais: `runtime.install`, `tools.system.exec`, `tools.filesystem.read`, `tools.filesystem.write`.
- Decide se o app pode tentar a acao.

2. Privilegio do sistema operacional
- Exigido por instalacao/operacoes administrativas no host.
- Linux: preferencia por `pkexec` quando houver prompt grafico/polkit.
- Fallbacks controlados: `sudo -n` (quando permitido) e fluxo assistido com terminal (`sudo` interativo) quando necessario.

## Estado atual (implementado)

- Instalacao de runtime no Linux:
  - prefere helper privilegiado whitelistado (`assets/helpers/linux/dexter-runtime-helper.sh`) via `pkexec` quando configurado e disponivel (uso automatico em build empacotada);
  - tenta `pkexec` quando disponivel;
  - sem `pkexec`, tenta `sudo -n` (nao interativo);
  - quando `sudo -n` exige TTY/senha, retorna `sudo_tty_required` com `nextSteps` para terminal;
  - quando politica sudo bloqueia o usuario, retorna `sudo_policy_denied` com diagnostico administrativo.
- Inicio de runtime no Linux:
  - tenta helper privilegiado (`start-ollama-service`) via `pkexec` para acionar service manager;
  - tenta service manager via `sudo -n` quando helper/pkexec nao estao disponiveis;
  - preserva fallback para `ollama serve` local.
- Reparo de runtime no Linux:
  - tenta helper privilegiado (`restart-ollama-service`) via `pkexec` para reinicio guiado;
  - tenta service manager via `sudo -n` quando aplicavel;
  - preserva fallback para fluxo de `startRuntime()` quando o helper falha/nao existe.
- Uninstall assistido no Linux:
  - exige token explicito de confirmacao (`UNINSTALL DEXTER`) antes de qualquer acao destrutiva;
  - opera por escopo whitelistado (`remove/purge` do pacote Dexter, limpeza opcional de dados locais, limpeza opcional de runtime Ollama);
  - privilegio segue a mesma matriz de runtime (`pkexec-helper` -> `pkexec` -> `sudo -n` -> assistido terminal);
  - nao aceita shell arbitrario da UI; somente comandos/acoes predefinidos no `main` e no helper Linux.
- Diagnostico do helper no Linux:
  - sonda `status` do helper sem `pkexec` para expor capabilities (sem elevar privilegio desnecessariamente);
  - classifica modo operacional do agente (`pkexec`, `sudo-noninteractive`, `sudo-terminal`, `none`) para evitar "falso pronto".
- UI possui onboarding de setup com checklist e CTA contextual baseado no estado real de runtime/modelos/health/permissoes.
- O onboarding marca estados finais distintos (`Pronto`, `Assistido`, `Limitado`) de acordo com o caminho real de privilegio disponivel no host.
- O onboarding pode executar `Reparar Setup` (orquestracao guiada no renderer): tenta reparo/reinicio do runtime quando aplicavel e consolida diagnostico final com runtime + helper + health + proximo passo.
- O card `Saude` pode acionar o mesmo `Reparar Setup`, reaproveitando o fluxo/contratos existentes (sem criar novo caminho privilegiado).
- A UI pode registrar eventos de auditoria local (`ui.audit.event`, ex.: `setup.repair.finish`) no processo principal para trilha exportavel sem criar novo canal privilegiado.
- O comando `/doctor` expoe esse mesmo diagnostico operacional no chat para suporte/troubleshooting sem abrir shell privilegiado na UI.

## Proximo passo recomendado (evoluir o helper privilegiado)

Quando o produto entrar em fase de "integracao total" mais profunda no Linux:

- expandir o helper privilegiado opcional com interface estrita (whitelist),
- acoplado a polkit,
- sem shell livre,
- auditavel e versionado junto com o Dexter.

Exemplos de acoes candidatas:

- instalar runtime Ollama,
- iniciar/parar runtime (ou integrar com service manager),
- checar status do runtime,
- reparos guiados limitados (sem execucao arbitraria),
- uninstall por escopo controlado (`remove/purge` + limpeza opcional).

## O que evitar

- Prompt de senha root dentro do renderer.
- Shell root generico controlado pela UI.
- Scripts `postinst` do `.deb` que baixam/instalam runtime automaticamente via internet sem confirmacao contextual.
- Mensagens genericas que escondem a causa real da falha.

## Protocolo no cerebro do agente (LLM)

- O prompt de sistema do Dexter inclui protocolo operacional explicito:
  - nao afirmar execucao de comandos/alteracoes que nao ocorreram;
  - tratar leitura/diagnostico como padrao;
  - exigir pedido explicito para escrita/sobrescrita/exclusao;
  - quando faltar contexto/permissao, responder com limite claro + proximo passo seguro.
- A Persona v1 fixa prioridades de decisao no prompt para reduzir drift comportamental:
  1) seguranca/permissoes
  2) veracidade sobre execucao real
  3) utilidade pratica
  4) concisao/didatica
- A consciencia situacional em tempo real usa apenas metadados locais (hora/data/fuso/usuario/host/diretorio do processo), sem ampliar superficie de escrita automatica.
- Nome de usuario em foco detectado no chat pode ser usado em escopo de sessao sem persistencia global implicita; alteracao persistente de apelido depende de comando explicito (`/name`).
- Aprendizado automatico de preferencias fica restrito a instrucoes explicitas de formato de resposta (idioma/tom/verbosidade), sem escrever configuracoes de sistema.
- Limpeza seletiva de memoria no inspector atua apenas no armazenamento local do Dexter (sessao/perfil/preferencias/notas), sem executar comandos administrativos no host.
- Esse protocolo complementa (nao substitui) as camadas de autorizacao do app e do sistema operacional.
