import type { ModuleManagerAction } from '@renderer/components/modules/ModuleManager';

export type LegacyUiCommand =
  | 'prompt-input'
  | 'messages-scroll'
  | 'messages-shell-scroll'
  | 'window-resize'
  | 'system-theme-change'
  | 'chat-scroll-bottom'
  | 'attach'
  | 'composer-context-action'
  | 'theme-mode-change'
  | 'runtime-helper-details-toggle'
  | 'repair-setup-health'
  | 'memory-clear-session'
  | 'memory-clear-preferences'
  | 'memory-clear-profile'
  | 'memory-clear-notes'
  | 'window-minimize'
  | 'window-toggle-tray'
  | 'runtime-install'
  | 'runtime-start'
  | 'runtime-repair'
  | 'setup-primary'
  | 'setup-secondary'
  | 'model-pull'
  | 'model-remove'
  | 'update-check'
  | 'update-download'
  | 'update-restart'
  | 'update-channel-change'
  | 'update-auto-check-change'
  | 'permission-runtime-install-change'
  | 'permission-fs-read-change'
  | 'permission-fs-write-change'
  | 'permission-system-exec-change'
  | 'history-prev'
  | 'history-next'
  | 'history-operation-filter-change'
  | 'history-status-filter-change'
  | 'export-history'
  | 'export-logs'
  | 'export-update-logs'
  | 'export-ui-audit-logs'
  | 'export-update-audit-trail'
  | 'export-update-audit-errors'
  | 'export-update-audit-family-change'
  | 'export-update-audit-severity-change'
  | 'export-update-audit-window-change'
  | 'export-update-audit-code-only-change'
  | 'export-log-scope-change'
  | 'export-format-change'
  | 'export-date-from-change'
  | 'export-date-to-change'
  | 'export-preset-today'
  | 'export-preset-7d'
  | 'export-preset-30d'
  | 'export-preset-clear';

export type UiIntent =
  | {
      type: 'send-prompt';
    }
  | {
      type: 'prompt-keydown';
      key: string;
      code: string;
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      defaultPrevented: boolean;
    }
  | {
      type: 'global-keydown';
      key: string;
      code: string;
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      defaultPrevented: boolean;
    }
  | {
      type: 'apply-model';
    }
  | {
      type: 'refresh-health';
      notify: boolean;
    }
  | {
      type: 'insert-command';
      command: string;
    }
  | {
      type: 'apply-command-suggestion';
      command: string;
    }
  | {
      type: 'apply-empty-state-command';
      command: string;
    }
  | {
      type: 'module-action';
      action: ModuleManagerAction;
    }
  | {
      type: 'run-legacy-command';
      command: LegacyUiCommand;
    };

const UI_INTENT_EVENT = 'dexter:ui-intent';

export function dispatchUiIntent(intent: UiIntent): void {
  window.dispatchEvent(
    new CustomEvent<UiIntent>(UI_INTENT_EVENT, {
      detail: intent
    })
  );
}

export function subscribeUiIntent(listener: (intent: UiIntent) => void): () => void {
  const handler = (event: Event): void => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = event.detail as UiIntent | null;
    if (!detail || typeof detail !== 'object' || typeof (detail as { type?: unknown }).type !== 'string') {
      return;
    }

    listener(detail);
  };

  window.addEventListener(UI_INTENT_EVENT, handler);
  return () => {
    window.removeEventListener(UI_INTENT_EVENT, handler);
  };
}
