import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ActiveView } from '@renderer/state/active-view';
import {
  getActiveView,
  setActiveView as setStoreActiveView,
  subscribeActiveView,
  type ActiveViewChangeOptions
} from '@renderer/state/active-view-store';

type UiViewContextValue = {
  activeView: ActiveView;
  setActiveView: (view: ActiveView, options?: ActiveViewChangeOptions) => void;
};

const UiViewContext = createContext<UiViewContextValue | null>(null);

export function UiViewProvider(props: { children: ReactNode }): JSX.Element {
  const { children } = props;
  const [activeView, setActiveViewState] = useState<ActiveView>(getActiveView());

  useEffect(() => {
    return subscribeActiveView((nextView) => {
      setActiveViewState(nextView);
    });
  }, []);

  const value = useMemo<UiViewContextValue>(
    () => ({
      activeView,
      setActiveView: (view, options) => {
        setStoreActiveView(view, options);
      }
    }),
    [activeView]
  );

  return <UiViewContext.Provider value={value}>{children}</UiViewContext.Provider>;
}

export function useUiView(): UiViewContextValue {
  const context = useContext(UiViewContext);
  if (!context) {
    throw new Error('useUiView deve ser usado dentro de UiViewProvider');
  }

  return context;
}
