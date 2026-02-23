import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('UpdateStateStore', () => {
  it('retorna default e nao expoe referencia mutavel interna', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-update-state-'));
    tempDirs.push(dir);

    const store = new UpdateStateStore(dir);
    const state = store.get();
    expect(state.phase).toBe('idle');
    expect(state.available).toBeNull();

    const next = store.set({
      phase: 'available',
      provider: 'mock',
      checkedAt: new Date().toISOString(),
      lastError: null,
      lastErrorCode: null,
      stagedVersion: null,
      stagedArtifactPath: null,
      available: {
        version: '0.1.4',
        channel: 'stable',
        provider: 'mock',
        publishedAt: new Date().toISOString(),
        releaseNotes: 'ok',
        downloadUrl: 'https://example.invalid',
        checksumSha256: 'abc',
        components: {
          appVersion: '0.1.4',
          coreVersion: '0.1.4',
          uiVersion: '0.1.4',
          ipcContractVersion: 1,
          userDataSchemaVersion: 1
        },
        compatibility: {
          strategy: 'atomic',
          requiresRestart: true,
          ipcContractCompatible: true,
          userDataSchemaCompatible: true,
          notes: ['safe']
        }
      }
    });

    if (!next.available) {
      throw new Error('manifest ausente');
    }
    next.available.compatibility.notes.push('mutated');

    const reloaded = store.get();
    expect(reloaded.available?.compatibility.notes).toEqual(['safe']);
  });

  it('autocorrige payload malformado', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-update-state-'));
    tempDirs.push(dir);

    const updateDir = path.join(dir, 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(path.join(updateDir, 'state.json'), '{"state":{"phase":"weird","provider":"x"}}', 'utf-8');

    const store = new UpdateStateStore(dir);
    const state = store.get();

    expect(state.phase).toBe('idle');
    expect(state.provider).toBe('none');
  });
});
