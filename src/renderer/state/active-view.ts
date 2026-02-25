export type ActiveView = 'chat' | 'modules' | 'settings' | 'governance';

export type ActiveViewMeta = {
  title: string;
  kicker: string;
  focusAnnouncement: string;
};

const VIEW_SET: ReadonlySet<ActiveView> = new Set(['chat', 'modules', 'settings', 'governance']);

export const ACTIVE_VIEW_META: Readonly<Record<ActiveView, ActiveViewMeta>> = {
  chat: {
    title: 'Chat Context',
    kicker: 'Workspace',
    focusAnnouncement: 'Contexto do chat em foco.'
  },
  modules: {
    title: 'Module Manager',
    kicker: 'Core + Extensoes',
    focusAnnouncement: 'Gerenciador de modulos em foco.'
  },
  settings: {
    title: 'Settings',
    kicker: 'Ajustes do sistema',
    focusAnnouncement: 'Configuracoes em foco.'
  },
  governance: {
    title: 'Governance',
    kicker: 'Permissoes e auditoria',
    focusAnnouncement: 'Governanca em foco.'
  }
} as const;

export function isActiveView(value: string): value is ActiveView {
  return VIEW_SET.has(value as ActiveView);
}

export function parseActiveView(value: string | null | undefined): ActiveView {
  if (!value) {
    return 'chat';
  }

  const normalized = value.trim().toLowerCase();
  return isActiveView(normalized) ? normalized : 'chat';
}
