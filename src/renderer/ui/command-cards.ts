export function buildCommandCardBody(content: string): HTMLElement | null {
  const healthCard = parseHealthCommandReply(content);
  if (healthCard) {
    return renderHealthCommandCard(healthCard, content);
  }

  const memoryCard = parseMemoryCommandReply(content);
  if (memoryCard) {
    return renderMemoryCommandCard(memoryCard, content);
  }

  const historyCard = parseHistoryCommandReply(content);
  if (historyCard) {
    return renderHistoryCommandCard(historyCard, content);
  }

  const envCard = parseEnvCommandReply(content);
  if (envCard) {
    return renderEnvCommandCard(envCard, content);
  }

  return null;
}

function parseHealthCommandReply(content: string):
  | {
      overall: string;
      services: Array<{ label: string; value: string }>;
      details: string[];
    }
  | null {
  const lines = content.split('\n').map((line) => line.trim());
  if (!lines[0]?.startsWith('Saude geral:')) {
    return null;
  }

  const overall = lines[0].slice('Saude geral:'.length).trim();
  const services: Array<{ label: string; value: string }> = [];
  const details: string[] = [];
  let detailsMode = false;

  for (const line of lines.slice(1)) {
    if (!line) {
      continue;
    }
    if (line === 'Detalhes:') {
      detailsMode = true;
      continue;
    }
    if (!line.startsWith('- ')) {
      continue;
    }

    const item = line.slice(2).trim();
    if (detailsMode) {
      details.push(item);
      continue;
    }

    const sep = item.indexOf(':');
    if (sep <= 0) {
      continue;
    }
    services.push({
      label: item.slice(0, sep).trim(),
      value: item.slice(sep + 1).trim()
    });
  }

  return {
    overall,
    services,
    details
  };
}

function parseMemoryCommandReply(content: string):
  | {
      rows: Array<{ label: string; value: string }>;
    }
  | null {
  const lines = content.split('\n').map((line) => line.trim());
  if (!lines[0]?.startsWith('Resumo de memoria:')) {
    return null;
  }

  const rows: Array<{ label: string; value: string }> = [];
  for (const line of lines.slice(1)) {
    if (!line.startsWith('- ')) {
      continue;
    }
    const item = line.slice(2).trim();
    const sep = item.indexOf(':');
    if (sep <= 0) {
      continue;
    }
    rows.push({
      label: item.slice(0, sep).trim(),
      value: item.slice(sep + 1).trim()
    });
  }

  return rows.length > 0 ? { rows } : null;
}

function parseHistoryCommandReply(content: string):
  | {
      empty: true;
      message: string;
    }
  | {
      empty: false;
      summary: string;
      items: Array<{
        status: string;
        title: string;
        meta: string;
        message: string | null;
      }>;
    }
  | null {
  const lines = content.split('\n');
  const first = lines[0]?.trim() ?? '';
  if (first === 'Historico vazio para os filtros informados.') {
    return {
      empty: true,
      message: first
    };
  }
  if (!first.startsWith('Historico de operacoes ')) {
    return null;
  }

  const items: Array<{
    status: string;
    title: string;
    meta: string;
    message: string | null;
  }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (!line.startsWith('- ')) {
      continue;
    }
    const bullet = line.slice(2).trim();
    const match = /^\[([^\]]+)\]\s+(.+?)(?:\s+\((.+)\))?$/.exec(bullet);
    if (!match) {
      continue;
    }

    const status = match[1]?.trim();
    const title = match[2]?.trim();
    const meta = match[3]?.trim() ?? '';
    if (!status || !title) {
      continue;
    }
    const next = lines[i + 1]?.trim() ?? '';
    const message = next && !next.startsWith('- ') ? next : null;
    if (message) {
      i += 1;
    }

    items.push({
      status,
      title,
      meta,
      message
    });
  }

  return {
    empty: false,
    summary: first,
    items
  };
}

function parseEnvCommandReply(content: string):
  | {
      rows: Array<{ label: string; value: string }>;
      tip: string | null;
    }
  | null {
  const lines = content.split('\n').map((line) => line.trim());
  if (!lines[0]?.startsWith('Ambiente local:')) {
    return null;
  }

  const rows: Array<{ label: string; value: string }> = [];
  let tip: string | null = null;

  for (const line of lines.slice(1)) {
    if (!line) {
      continue;
    }
    if (line.startsWith('Use /health')) {
      tip = line;
      continue;
    }
    if (!line.startsWith('- ')) {
      continue;
    }

    const item = line.slice(2).trim();
    const sep = item.indexOf(':');
    if (sep <= 0) {
      continue;
    }
    rows.push({
      label: item.slice(0, sep).trim(),
      value: item.slice(sep + 1).trim()
    });
  }

  return {
    rows,
    tip
  };
}

function renderHealthCommandCard(
  parsed: {
    overall: string;
    services: Array<{ label: string; value: string }>;
    details: string[];
  },
  raw: string
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'message-body command-card command-card-health';

  const header = document.createElement('div');
  header.className = 'command-card-head';

  const title = document.createElement('strong');
  title.className = 'command-card-title';
  title.textContent = 'Saude do sistema';

  const badge = document.createElement('span');
  badge.className = 'command-card-badge';
  const overallUpper = parsed.overall.toUpperCase();
  badge.textContent = overallUpper;
  badge.dataset.tone = overallUpper.includes('OK') ? 'ok' : 'warn';

  header.append(title, badge);
  root.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'command-health-grid';

  for (const service of parsed.services) {
    const item = document.createElement('div');
    item.className = 'command-health-item';

    const label = document.createElement('span');
    label.className = 'command-health-label';
    label.textContent = service.label;

    const value = document.createElement('span');
    value.className = 'command-health-value';
    value.textContent = service.value;
    value.dataset.tone = classifyHealthValueTone(service.value);

    item.append(label, value);
    grid.appendChild(item);
  }

  root.appendChild(grid);

  if (parsed.details.length > 0) {
    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'command-card-section';

    const sectionLabel = document.createElement('p');
    sectionLabel.className = 'command-card-section-label';
    sectionLabel.textContent = 'Detalhes';

    const list = document.createElement('ul');
    list.className = 'command-list';
    for (const detail of parsed.details) {
      const li = document.createElement('li');
      li.textContent = detail;
      list.appendChild(li);
    }

    detailsWrap.append(sectionLabel, list);
    root.appendChild(detailsWrap);
  }

  root.appendChild(buildCommandRawDetails(raw));
  return root;
}

function renderMemoryCommandCard(
  parsed: {
    rows: Array<{ label: string; value: string }>;
  },
  raw: string
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'message-body command-card command-card-memory';

  const header = document.createElement('div');
  header.className = 'command-card-head';
  const title = document.createElement('strong');
  title.className = 'command-card-title';
  title.textContent = 'Resumo de memoria';
  header.appendChild(title);
  root.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'command-memory-grid';

  for (const row of parsed.rows) {
    const item = document.createElement('div');
    item.className = 'command-memory-item';

    const label = document.createElement('span');
    label.className = 'command-memory-label';
    label.textContent = row.label;

    const value = document.createElement('strong');
    value.className = 'command-memory-value';
    value.textContent = row.value;

    item.append(label, value);
    grid.appendChild(item);
  }

  root.appendChild(grid);
  root.appendChild(buildCommandRawDetails(raw));
  return root;
}

function renderHistoryCommandCard(
  parsed:
    | {
        empty: true;
        message: string;
      }
    | {
        empty: false;
        summary: string;
        items: Array<{
          status: string;
          title: string;
          meta: string;
          message: string | null;
        }>;
      },
  raw: string
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'message-body command-card command-card-history';

  const header = document.createElement('div');
  header.className = 'command-card-head';

  const title = document.createElement('strong');
  title.className = 'command-card-title';
  title.textContent = 'Historico de modelos';
  header.appendChild(title);
  root.appendChild(header);

  if (parsed.empty) {
    const empty = document.createElement('p');
    empty.className = 'command-card-tip';
    empty.textContent = parsed.message;
    root.appendChild(empty);
    root.appendChild(buildCommandRawDetails(raw));
    return root;
  }

  const summary = document.createElement('p');
  summary.className = 'command-card-tip';
  summary.textContent = parsed.summary;
  root.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'command-history-list';

  for (const itemData of parsed.items) {
    const item = document.createElement('div');
    item.className = 'command-history-item';

    const top = document.createElement('div');
    top.className = 'command-history-top';

    const status = document.createElement('span');
    status.className = 'command-history-status';
    status.textContent = itemData.status;
    status.dataset.tone = classifyHistoryStatusTone(itemData.status);

    const titleLine = document.createElement('span');
    titleLine.className = 'command-history-title';
    titleLine.textContent = itemData.title;

    top.append(status, titleLine);
    item.appendChild(top);

    if (itemData.meta) {
      const meta = document.createElement('p');
      meta.className = 'command-history-meta';
      meta.textContent = itemData.meta;
      item.appendChild(meta);
    }

    if (itemData.message) {
      const msg = document.createElement('p');
      msg.className = 'command-history-message';
      msg.textContent = itemData.message;
      item.appendChild(msg);
    }

    list.appendChild(item);
  }

  root.appendChild(list);
  root.appendChild(buildCommandRawDetails(raw));
  return root;
}

function renderEnvCommandCard(
  parsed: {
    rows: Array<{ label: string; value: string }>;
    tip: string | null;
  },
  raw: string
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'message-body command-card command-card-env';

  const header = document.createElement('div');
  header.className = 'command-card-head';

  const title = document.createElement('strong');
  title.className = 'command-card-title';
  title.textContent = 'Ambiente local';
  header.appendChild(title);
  root.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'command-env-grid';

  for (const row of parsed.rows) {
    const item = document.createElement('div');
    item.className = 'command-env-item';

    const label = document.createElement('span');
    label.className = 'command-env-label';
    label.textContent = row.label;

    const valueWrap = document.createElement('div');
    valueWrap.className = 'command-env-value';
    appendEnvValueContent(valueWrap, row.label, row.value);

    item.append(label, valueWrap);
    grid.appendChild(item);
  }

  root.appendChild(grid);

  if (parsed.tip) {
    const tip = document.createElement('p');
    tip.className = 'command-card-tip';
    tip.textContent = parsed.tip;
    root.appendChild(tip);
  }

  root.appendChild(buildCommandRawDetails(raw));
  return root;
}

function appendEnvValueContent(target: HTMLElement, label: string, value: string): void {
  const normalized = label.toLowerCase();
  const asChipList = normalized === 'comandos disponiveis' || normalized === 'comandos ausentes';
  if (!asChipList) {
    target.textContent = value;
    return;
  }

  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (list.length === 0) {
    target.textContent = value;
    return;
  }

  const chips = document.createElement('div');
  chips.className = 'command-chip-list';
  for (const item of list) {
    const chip = document.createElement('span');
    chip.className = 'command-chip';
    chip.dataset.tone = normalized.includes('ausentes') ? 'warn' : 'ok';
    chip.textContent = item;
    chips.appendChild(chip);
  }
  target.appendChild(chips);
}

function buildCommandRawDetails(raw: string): HTMLElement {
  const details = document.createElement('details');
  details.className = 'command-raw';

  const summary = document.createElement('summary');
  summary.textContent = 'Ver texto bruto';

  const pre = document.createElement('pre');
  pre.textContent = raw;

  details.append(summary, pre);
  return details;
}

function classifyHealthValueTone(value: string): 'ok' | 'warn' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ok' || normalized === 'online' || normalized === 'disponivel') {
    return 'ok';
  }
  return 'warn';
}

function classifyHistoryStatusTone(status: string): 'ok' | 'warn' | 'busy' {
  const normalized = status.trim().toUpperCase();
  if (normalized === 'CONCLUIDO') {
    return 'ok';
  }
  if (normalized === 'EM ANDAMENTO') {
    return 'busy';
  }
  return 'warn';
}
