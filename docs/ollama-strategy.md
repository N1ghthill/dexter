# Estrategia Ollama (Fase Inicial)

## Pergunta-chave

Vale embutir Ollama como dependencia obrigatoria do pacote do Dexter?

## Resposta para esta fase

Nao. O caminho mais seguro agora e manter Ollama como runtime externo detectado automaticamente.

## Motivos

- Menor complexidade de distribuicao multiplataforma.
- Menor risco legal/operacional ao redistribuir componentes de terceiros.
- Ciclo de atualizacao mais simples (Ollama evolui independente do Dexter).
- Menos chance de quebrar instalacao do app por detalhes de runtime.

## Mitigacao de UX

- Health check no boot para verificar `http://127.0.0.1:11434`.
- Tela de onboarding explicando em passos curtos como habilitar Ollama.
- Mensagens amigaveis e acionaveis quando indisponivel.

## Plano de evolucao

1. Suporte a multiplos providers locais.
2. Instaler assistido opcional para runtime.
3. Politica de fallback e diagnostico automatico.
