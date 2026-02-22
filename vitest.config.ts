import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@shared': path.resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text', 'json-summary', 'lcov'],
      include: [
        'src/main/ipc/registerIpc.ts',
        'src/main/preload.ts',
        'src/main/services/agent/**/*.ts',
        'src/main/services/audit/AuditExportService.ts',
        'src/main/services/commands/CommandRouter.ts',
        'src/main/services/config/ConfigStore.ts',
        'src/main/services/health/HealthService.ts',
        'src/main/services/llm/OllamaProvider.ts',
        'src/main/services/memory/MemoryStore.ts',
        'src/main/services/models/ModelCatalog.ts',
        'src/main/services/models/ModelHistoryService.ts',
        'src/main/services/models/ModelService.ts',
        'src/main/services/permissions/PermissionService.ts',
        'src/main/services/runtime/RuntimeService.ts'
      ],
      thresholds: {
        perFile: true,
        lines: 60,
        statements: 60,
        functions: 90,
        branches: 55
      }
    }
  }
});
