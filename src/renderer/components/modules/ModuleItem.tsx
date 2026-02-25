import type { JSX } from 'react';

export type ModuleActionKind = 'toggle' | 'config' | 'install';

export type ModuleAction = {
  id: string;
  label: string;
  kind: ModuleActionKind;
  checked?: boolean;
  disabled?: boolean;
  tooltip?: string;
};

export type ModuleItemModel = {
  id: string;
  name: string;
  description: string;
  status: string;
  isCore: boolean;
  actions: ReadonlyArray<ModuleAction>;
};

type ModuleItemProps = {
  item: ModuleItemModel;
};

export default function ModuleItem(props: ModuleItemProps): JSX.Element {
  const { item } = props;

  return (
    <li className={`module-catalog-item${item.isCore ? ' module-catalog-item-core' : ''}`} data-module-id={item.id}>
      <div className="module-catalog-head">
        <p className="module-catalog-title">
          {item.name}
          {item.isCore ? <span className="module-core-tag">core</span> : null}
        </p>
        <span className="module-catalog-status">{item.status}</span>
      </div>
      <p className="module-catalog-description">{item.description}</p>
      <div className="module-catalog-actions">
        {item.actions.map((action) => {
          if (action.kind === 'toggle') {
            return (
              <label className="module-action-toggle" key={action.id} title={action.tooltip}>
                <input
                  type="checkbox"
                  data-module-action={action.id}
                  data-module-id={item.id}
                  defaultChecked={action.checked}
                  disabled={action.disabled}
                />
                <span>{action.label}</span>
              </label>
            );
          }

          return (
            <button
              className="btn ghost"
              type="button"
              key={action.id}
              data-module-action={action.id}
              data-module-id={item.id}
              disabled={action.disabled}
              title={action.tooltip}
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}
