import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '@main/services/config/ConfigStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ConfigStore', () => {
  it('carrega configuracao valida persistida em disco', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-config-'));
    tempDirs.push(dir);

    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'dexter.config.json'),
      JSON.stringify(
        {
          model: 'qwen2.5:7b',
          endpoint: 'https://models.exemplo.dev',
          personality: 'Perfil customizado.'
        },
        null,
        2
      ),
      'utf-8'
    );

    const store = new ConfigStore(dir);
    expect(store.get()).toMatchObject({
      model: 'qwen2.5:7b',
      endpoint: 'https://models.exemplo.dev',
      personality: 'Perfil customizado.'
    });
  });

  it('normaliza nome do modelo e ignora atualizacao vazia', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-config-'));
    tempDirs.push(dir);

    const store = new ConfigStore(dir);
    const updated = store.setModel('   qwen2.5:7b   ');
    expect(updated.model).toBe('qwen2.5:7b');

    const afterBlank = store.setModel('   ');
    expect(afterBlank.model).toBe('qwen2.5:7b');
  });

  it('retorna fallback seguro quando arquivo de config esta invalido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-config-'));
    tempDirs.push(dir);

    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'dexter.config.json'), '{invalido', 'utf-8');

    const store = new ConfigStore(dir);
    expect(store.get().model).toBe('llama3.2:3b');
    expect(store.get().endpoint).toBe('http://127.0.0.1:11434');
  });

  it('reaplica fallback quando JSON e valido, mas schema esta invalido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-config-'));
    tempDirs.push(dir);

    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'dexter.config.json'),
      JSON.stringify(
        {
          model: '',
          endpoint: 'nao-e-url',
          personality: ''
        },
        null,
        2
      ),
      'utf-8'
    );

    const store = new ConfigStore(dir);
    expect(store.get().model).toBe('llama3.2:3b');
    expect(store.get().endpoint).toBe('http://127.0.0.1:11434');

    const persisted = JSON.parse(fs.readFileSync(path.join(configDir, 'dexter.config.json'), 'utf-8')) as {
      model: string;
      endpoint: string;
      personality: string;
    };
    expect(persisted.model).toBe('llama3.2:3b');
    expect(persisted.endpoint).toBe('http://127.0.0.1:11434');
    expect(persisted.personality.length).toBeGreaterThan(0);
  });
});
