import type { CuratedModel, ModelSizeClass } from '@shared/contracts';

interface CuratedBaseModel {
  name: string;
  label: string;
  description: string;
  sizeClass: ModelSizeClass;
  recommended: boolean;
}

const CURATED_BASE_MODELS: CuratedBaseModel[] = [
  {
    name: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    description: 'Equilibrio entre qualidade e desempenho em CPU/GPU local.',
    sizeClass: 'small',
    recommended: true
  },
  {
    name: 'llama3.2:1b',
    label: 'Llama 3.2 1B',
    description: 'Opcao leve para maquinas com menos memoria.',
    sizeClass: 'small',
    recommended: false
  },
  {
    name: 'qwen2.5:7b',
    label: 'Qwen 2.5 7B',
    description: 'Boa compreensao geral com contexto mais robusto.',
    sizeClass: 'medium',
    recommended: true
  },
  {
    name: 'mistral:7b',
    label: 'Mistral 7B',
    description: 'Modelo geral rapido e confiavel para assistente local.',
    sizeClass: 'medium',
    recommended: false
  },
  {
    name: 'phi3:mini',
    label: 'Phi-3 Mini',
    description: 'Bom para respostas objetivas e baixa latencia.',
    sizeClass: 'small',
    recommended: false
  },
  {
    name: 'deepseek-r1:8b',
    label: 'DeepSeek R1 8B',
    description: 'Foco em raciocinio mais estruturado localmente.',
    sizeClass: 'large',
    recommended: false
  }
];

export function buildCuratedCatalog(installedNames: Set<string>): CuratedModel[] {
  return CURATED_BASE_MODELS.map((model) => ({
    ...model,
    installed: installedNames.has(model.name)
  }));
}
