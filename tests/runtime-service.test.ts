import { describe, expect, it } from 'vitest';
import { endpointToOllamaHost } from '@main/services/runtime/RuntimeService';

describe('RuntimeService', () => {
  it('converte endpoint para formato aceito por OLLAMA_HOST', () => {
    expect(endpointToOllamaHost('http://127.0.0.1:11434')).toBe('127.0.0.1:11434');
    expect(endpointToOllamaHost('https://example.com')).toBe('example.com:443');
    expect(endpointToOllamaHost('http://localhost')).toBe('localhost:80');
    expect(endpointToOllamaHost('http://[::1]:11434')).toBe('[::1]:11434');
    expect(endpointToOllamaHost('ftp://models.example.com:2121')).toBe('models.example.com:2121');
    expect(endpointToOllamaHost('ws://models.example.com')).toBe('models.example.com');
  });

  it('retorna null para endpoint invalido', () => {
    expect(endpointToOllamaHost('nao-e-url')).toBeNull();
    expect(endpointToOllamaHost('file:///tmp/socket')).toBeNull();
  });
});
