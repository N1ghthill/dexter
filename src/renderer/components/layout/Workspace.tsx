import { useEffect, type JSX, type KeyboardEvent, type MouseEvent } from 'react';
import { dispatchUiIntent, type LegacyUiCommand } from '@renderer/state/ui-intents';

export default function Workspace(): JSX.Element {
  useEffect(() => {
    const handleResize = (): void => {
      dispatchUiIntent({
        type: 'run-legacy-command',
        command: 'window-resize'
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      dispatchUiIntent({
        type: 'run-legacy-command',
        command: 'system-theme-change'
      });
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    mediaQuery.addListener(handleChange);
    return () => {
      mediaQuery.removeListener(handleChange);
    };
  }, []);

  const handleLegacyCommand = (command: LegacyUiCommand): void => {
    dispatchUiIntent({
      type: 'run-legacy-command',
      command
    });
  };

  const handleApplyModelClick = (): void => {
    dispatchUiIntent({
      type: 'apply-model'
    });
  };

  const handleHealthClick = (): void => {
    dispatchUiIntent({
      type: 'refresh-health',
      notify: true
    });
  };

  const handleSendClick = (): void => {
    dispatchUiIntent({
      type: 'send-prompt'
    });
  };

  const handleInsertCommand = (command: string): void => {
    dispatchUiIntent({
      type: 'insert-command',
      command
    });
  };

  const handleApplyCommandSuggestion = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('.command-suggest-item[data-command]');
    const command = button?.dataset.command?.trim();
    if (!button || !command) {
      return;
    }

    dispatchUiIntent({
      type: 'apply-command-suggestion',
      command
    });
  };

  const handleEmptyStateCommandClick = (event: MouseEvent<HTMLElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('.chat-empty-chip[data-command]');
    const command = button?.dataset.command?.trim();
    if (!button || !command) {
      return;
    }

    dispatchUiIntent({
      type: 'apply-empty-state-command',
      command
    });
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const key = event.key;
    const isEnterSend = key === 'Enter' && !event.shiftKey;
    const isSuggestionNavKey = key === 'ArrowDown' || key === 'ArrowUp' || key === 'Tab' || key === 'Escape';
    const suggestElement = document.getElementById('commandSuggest');
    const suggestionsVisible = suggestElement instanceof HTMLElement && !suggestElement.hidden;
    const shouldDispatch = isEnterSend || (suggestionsVisible && isSuggestionNavKey);

    if (!shouldDispatch) {
      return;
    }

    if (isEnterSend || (suggestionsVisible && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Tab'))) {
      event.preventDefault();
    }

    dispatchUiIntent({
      type: 'prompt-keydown',
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      defaultPrevented: event.defaultPrevented
    });
  };

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>Dexter</h1>
          <p className="subtitle">Assistente local modular</p>
        </div>

        <div className="top-controls">
          <label className="theme-editor">
            <span>Tema</span>
            <select
              id="themeModeSelect"
              aria-label="Tema da interface"
              onChange={() => handleLegacyCommand('theme-mode-change')}
            >
              <option value="system">sistema</option>
              <option value="dark">escuro</option>
              <option value="light">claro</option>
            </select>
          </label>
          <label className="model-editor">
            <span>Modelo</span>
            <input id="modelInput" type="text" placeholder="llama3.2:3b" />
          </label>
          <button id="applyModelBtn" className="btn ghost" onClick={handleApplyModelClick}>
            Aplicar
          </button>
          <button id="healthBtn" className="btn ghost" onClick={handleHealthClick}>
            Health
          </button>
          <button id="minimizeBtn" className="btn ghost" onClick={() => handleLegacyCommand('window-minimize')}>
            Minimizar
          </button>
          <button id="trayBtn" className="btn ghost" onClick={() => handleLegacyCommand('window-toggle-tray')}>
            Bandeja
          </button>
          <div className="status-chip topbar-status" id="statusChip">
            Inicializando
          </div>
        </div>
      </header>

      <section className="chat-panel" id="chatPanel">
        <section className="chat-hero" id="chatHeroCard" aria-label="Resumo rapido do chat">
          <img className="chat-hero-art" src="../../assets/illustrations/mascot/hero-grin-ui-512.webp" alt="" />
          <div className="chat-hero-copy">
            <p className="chat-hero-kicker">Dexter local</p>
            <h2>Conversa com contexto local e foco em operacao</h2>
            <p className="chat-hero-text">
              Use comandos como <code>/help</code>, <code>/health</code> e <code>/env</code> para diagnostico rapido.
            </p>
            <div className="chat-hero-pills">
              <span id="chatHeroModelPill" className="chat-hero-pill">
                modelo: --
              </span>
              <span id="chatHeroRuntimePill" className="chat-hero-pill">
                runtime: --
              </span>
              <span id="chatHeroUpdatePill" className="chat-hero-pill">
                updates: --
              </span>
            </div>
          </div>
        </section>

        <div id="messagesShell" className="messages-shell" onScroll={() => handleLegacyCommand('messages-shell-scroll')}>
          <div id="chatStickyContextBar" className="chat-sticky-context" hidden aria-hidden="true">
            <span className="chat-sticky-context-label">Contexto</span>
            <div className="chat-sticky-context-pills">
              <span id="chatStickyModelPill" className="chat-hero-pill chat-sticky-pill">
                modelo: --
              </span>
              <span id="chatStickyRuntimePill" className="chat-hero-pill chat-sticky-pill">
                runtime: --
              </span>
              <span id="chatStickyUpdatePill" className="chat-hero-pill chat-sticky-pill">
                updates: --
              </span>
            </div>
          </div>
          <div id="messages" className="messages" aria-live="polite" onScroll={() => handleLegacyCommand('messages-scroll')}>
            <section id="chatEmptyState" className="chat-empty-state" onClick={handleEmptyStateCommandClick}>
              <img className="chat-empty-art" src="../../assets/illustrations/mascot/pointing-up-ui-320.webp" alt="" />
              <div className="chat-empty-copy">
                <p className="chat-empty-title">Pronto para comecar.</p>
                <p className="chat-empty-text">
                  Pergunte algo direto ou experimente um comando. O Dexter usa contexto local e mostra diagnosticos no painel.
                </p>
                <div className="chat-empty-chips" aria-label="Sugestoes de comandos">
                  <button className="chat-empty-chip" type="button" data-command="/help">
                    /help
                  </button>
                  <button className="chat-empty-chip" type="button" data-command="/health">
                    /health
                  </button>
                  <button className="chat-empty-chip" type="button" data-command="/env">
                    /env
                  </button>
                  <button className="chat-empty-chip" type="button" data-command="/model">
                    /model
                  </button>
                </div>
              </div>
            </section>
          </div>
          <button
            id="chatScrollToBottomBtn"
            className="chat-scroll-bottom-btn"
            type="button"
            hidden
            aria-label="Voltar ao fim do chat"
            title="Voltar ao fim do chat"
            onClick={() => handleLegacyCommand('chat-scroll-bottom')}
          >
            <span className="chat-scroll-bottom-icon" aria-hidden="true">
              ↓
            </span>
            <span className="chat-scroll-bottom-label">Voltar ao fim</span>
            <span id="chatScrollToBottomCount" className="chat-scroll-bottom-count" hidden></span>
          </button>
        </div>
        <span id="chatActionLive" className="sr-only" aria-live="polite" aria-atomic="true"></span>

        <div className="composer">
          <div className="composer-shell" id="composerShell">
            <div className="composer-toolbar" aria-label="Acoes do composer">
              <button
                id="attachBtn"
                className="btn ghost btn-icon"
                type="button"
                disabled
                aria-label="Anexar (em breve)"
                onClick={() => handleLegacyCommand('attach')}
              >
                📎
              </button>
              <button
                id="composerContextActionBtn"
                className="btn btn-chip btn-chip-primary-context"
                type="button"
                hidden
                onClick={() => handleLegacyCommand('composer-context-action')}
              ></button>
              <button
                id="insertHelpBtn"
                className="btn ghost btn-chip"
                type="button"
                data-command="/help"
                onClick={() => handleInsertCommand('/help')}
              >
                /help
              </button>
              <button
                id="insertHealthBtn"
                className="btn ghost btn-chip"
                type="button"
                data-command="/health"
                onClick={() => handleInsertCommand('/health')}
              >
                /health
              </button>
              <button
                id="insertEnvBtn"
                className="btn ghost btn-chip"
                type="button"
                data-command="/env"
                onClick={() => handleInsertCommand('/env')}
              >
                /env
              </button>
            </div>

            <textarea
              id="promptInput"
              placeholder="Digite /help para comandos ou faca uma pergunta..."
              rows={2}
              onKeyDown={handlePromptKeyDown}
              onInput={() => handleLegacyCommand('prompt-input')}
            ></textarea>
            <div
              id="commandSuggest"
              className="command-suggest"
              role="listbox"
              aria-label="Sugestoes de comandos"
              hidden
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleApplyCommandSuggestion}
            >
              <div id="commandSuggestList" className="command-suggest-list"></div>
              <div id="commandSuggestPreview" className="command-suggest-preview" aria-live="polite"></div>
            </div>

            <div className="composer-foot">
              <div className="composer-meta">
                <span id="composerBusyIndicator" className="composer-busy" hidden>
                  Dexter analisando...
                </span>
                <span className="composer-shortcuts">Enter envia • Shift+Enter quebra linha</span>
                <span id="composerFeedbackLive" className="sr-only" aria-live="polite" aria-atomic="true"></span>
                <span id="composerContextActionLive" className="sr-only" aria-live="polite" aria-atomic="true"></span>
              </div>
              <button id="sendBtn" className="btn primary" type="button" onClick={handleSendClick}>
                Enviar
              </button>
            </div>
          </div>
        </div>

        <p className="hint">Comandos curtos: /help /health /history /clear /model /mem /remember</p>
      </section>
    </main>
  );
}
