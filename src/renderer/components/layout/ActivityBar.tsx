import type { JSX, ReactNode } from 'react';
import { useUiView } from '@renderer/context/UiViewContext';
import type { ActiveView } from '@renderer/state/active-view';

type ActivityBarButtonProps = {
  view: ActiveView;
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ActivityBarButton(props: ActivityBarButtonProps): JSX.Element {
  const { view, label, tooltip, active, onClick, children } = props;

  return (
    <button
      className={`module-btn activity-btn${active ? ' active' : ''}`}
      type="button"
      data-module-nav={view}
      data-tooltip={tooltip}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function ActivityBar(): JSX.Element {
  const { activeView, setActiveView } = useUiView();

  return (
    <aside className="activity-bar" aria-label="Navegacao principal">
      <div className="activity-brand" aria-hidden="true">
        DX
      </div>
      <nav className="module-nav activity-nav" aria-label="Views principais">
        <ActivityBarButton
          view="chat"
          label="Chat"
          tooltip="Chat"
          active={activeView === 'chat'}
          onClick={() => setActiveView('chat', { announce: true, focus: true, smooth: true, source: 'ui' })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </ActivityBarButton>

        <ActivityBarButton
          view="modules"
          label="Modulos"
          tooltip="Modulos"
          active={activeView === 'modules'}
          onClick={() => setActiveView('modules', { announce: true, focus: true, smooth: true, source: 'ui' })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2l3 3h4a2 2 0 0 1 2 2v4l3 3-3 3v4a2 2 0 0 1-2 2h-4l-3 3-3-3H5a2 2 0 0 1-2-2v-4L0 14l3-3V7a2 2 0 0 1 2-2h4z" />
          </svg>
        </ActivityBarButton>

        <ActivityBarButton
          view="settings"
          label="Configuracoes"
          tooltip="Configuracoes"
          active={activeView === 'settings'}
          onClick={() => setActiveView('settings', { announce: true, focus: true, smooth: true, source: 'ui' })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2v3" />
            <path d="M12 19v3" />
            <path d="M4.93 4.93l2.12 2.12" />
            <path d="M16.95 16.95l2.12 2.12" />
            <path d="M2 12h3" />
            <path d="M19 12h3" />
            <path d="M4.93 19.07l2.12-2.12" />
            <path d="M16.95 7.05l2.12-2.12" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </ActivityBarButton>

        <ActivityBarButton
          view="governance"
          label="Governanca"
          tooltip="Governanca"
          active={activeView === 'governance'}
          onClick={() => setActiveView('governance', { announce: true, focus: true, smooth: true, source: 'ui' })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l8 4v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V7z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </ActivityBarButton>
      </nav>
    </aside>
  );
}
