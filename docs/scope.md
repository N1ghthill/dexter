# Escopo Inicial Oficial - Dexter

## 1. Produto

Dexter sera um assistente de IA local, amigavel e personalizavel, com UI moderna e modular baseada em Electron.

## 2. Escopo desta fase

- Conversacao local com provider Ollama.
- Interface premium para chat com paines de saude e memoria.
- Comandos curtos para operacao e diagnostico.
- Memoria em camadas (curto, medio e longo prazo) com persistencia local.
- Logs e health checks para auditoria e debug.
- Testes unitarios dos modulos criticos.
- Distribuicao oficial focada em Linux.

## 3. Fora do escopo imediato

- Acesso direto ao sistema de arquivos.
- Execucao de tools sensiveis sem policy engine.
- Automacoes com privilegios elevados.

## 4. Requisitos de qualidade

- Arquitetura modular e extensivel.
- IPC seguro e restrito.
- Falhas tratadas com mensagens acionaveis.
- Documentacao clara para onboarding tecnico.

## 5. Requisitos de experiencia

- Comandos curtos, legiveis e sem jargao.
- Feedback visual de estado do agente.
- Operacao simples para usuarios tecnicos e nao tecnicos.

## 6. Decisao tecnica desta fase

- Ollama como runtime externo detectado.
- Estrategia de onboarding para setup assistido.
- Provedor LLM desacoplado para futuras opcoes.
