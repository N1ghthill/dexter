import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { HealthService } from '@main/services/health/HealthService';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('HealthService', () => {
  it('trata resposta HTTP nao-ok como runtime indisponivel', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        models: [{ name: 'llama3.2:3b' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const report = await service.report();
    expect(report.ok).toBe(false);
    expect(report.ollamaReachable).toBe(false);
    expect(report.modelAvailable).toBe(false);
    expect(report.details.some((item) => item.includes('Ollama nao foi encontrado'))).toBe(true);
    expect(report.details.some((item) => item.includes('Modelo ativo nao encontrado'))).toBe(false);
  });

  it('nao reporta modelo ausente quando runtime esta offline', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const report = await service.report();
    expect(report.ollamaReachable).toBe(false);
    expect(report.modelAvailable).toBe(false);
    expect(report.details.some((item) => item.includes('Modelo ativo nao encontrado'))).toBe(false);
  });

  it('indica modelo ausente quando endpoint responde sem o modelo ativo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'outro-modelo:1b' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const report = await service.report();
    expect(report.ollamaReachable).toBe(true);
    expect(report.modelAvailable).toBe(false);
    expect(report.details.some((item) => item.includes('Modelo ativo nao encontrado'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('filtra nomes invalidos de modelo e trata payload sem models', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 42 }, {}, { name: 'llama3.2:3b' }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => null
      });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const available = await service.report();
    expect(available.ollamaReachable).toBe(true);
    expect(available.modelAvailable).toBe(true);

    const withoutModels = await service.report();
    expect(withoutModels.ollamaReachable).toBe(true);
    expect(withoutModels.modelAvailable).toBe(false);
    expect(withoutModels.details.some((item) => item.includes('Modelo ativo nao encontrado'))).toBe(true);
  });

  it('trata resposta JSON invalida como endpoint alcancavel com modelo indisponivel', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('json invalido');
      }
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const report = await service.report();
    expect(report.ollamaReachable).toBe(true);
    expect(report.modelAvailable).toBe(false);
    expect(report.details.some((item) => item.includes('Ollama nao foi encontrado'))).toBe(false);
    expect(report.details.some((item) => item.includes('Modelo ativo nao encontrado'))).toBe(true);
  });

  it('aborta a chamada de tags quando o timeout expira', async () => {
    vi.useFakeTimers();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new Error('abortado'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const pending = service.report();
    await vi.advanceTimersByTimeAsync(2100);
    const report = await pending;

    expect(report.ollamaReachable).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.details.some((item) => item.includes('Ollama nao foi encontrado'))).toBe(true);
  });

  it('reporta ok quando runtime e modelo estao disponiveis e dependencias internas estao saudaveis', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2:3b' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const service = new HealthService(config, memory, logger);

    const report = await service.report();
    expect(report.ok).toBe(true);
    expect(report.details).toEqual([]);
  });

  it('inclui detalhes quando memoria e logs estao indisponiveis', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-health-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2:3b' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    vi.spyOn(memory, 'isHealthy').mockReturnValue(false);
    vi.spyOn(logger, 'isHealthy').mockReturnValue(false);

    const service = new HealthService(config, memory, logger);
    const report = await service.report();

    expect(report.ok).toBe(false);
    expect(report.memoryHealthy).toBe(false);
    expect(report.loggingHealthy).toBe(false);
    expect(report.details.some((item) => item.includes('Camada de memoria'))).toBe(true);
    expect(report.details.some((item) => item.includes('Sistema de logs'))).toBe(true);
  });
});
