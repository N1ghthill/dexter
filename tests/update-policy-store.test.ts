import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UpdatePolicyStore } from '@main/services/update/UpdatePolicyStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('UpdatePolicyStore', () => {
  it('cria politica default e persiste patch valido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-update-policy-'));
    tempDirs.push(dir);

    const store = new UpdatePolicyStore(dir);
    const initial = store.get();
    expect(initial.channel).toBe('stable');
    expect(initial.autoCheck).toBe(true);

    const updated = store.set({
      channel: 'rc',
      autoCheck: false
    });
    expect(updated.channel).toBe('rc');
    expect(updated.autoCheck).toBe(false);
  });

  it('autocorrige arquivo invalido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-update-policy-'));
    tempDirs.push(dir);

    const updateDir = path.join(dir, 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(path.join(updateDir, 'policy.json'), '{"policy":{"channel":"zzz","autoCheck":"x"}}', 'utf-8');

    const store = new UpdatePolicyStore(dir);
    const policy = store.get();

    expect(policy.channel).toBe('stable');
    expect(policy.autoCheck).toBe(true);
    expect(Number.isFinite(Date.parse(policy.updatedAt))).toBe(true);
  });
});
