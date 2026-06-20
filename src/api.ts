import { ServerConnection } from '@jupyterlab/services';

import { requestAPI } from './request';

// 1. 定义接口

export interface ICellDescriptor {
  cellId: string;
  cellIndex: number;
  cellType: string;
  source: string;
  summary?: string;
}

export interface ICellSummaryResponse {
  status: 'success' | 'error';
  cellId: string;
  cellIndex: number | null;
  cellType: string;
  title?: string;
  summary: string;
  details: string;
  metadata: {
    source: string;
  };
}

export interface ISuggestion {
  id: string;
  title: string;
  description: string;
  cellType: string;
  content: string;
  metadata: {
    source: string;
  };
}

export interface IBackendSuggestion {
  id?: string;
  title?: string;
  description?: string;
  cellType?: string;
  content?: string;
  metadata?: {
    source?: string;
  };
}

export interface INextStepContext {
  previousCells: ICellDescriptor[];
  nextCells: ICellDescriptor[];
  tree: ITreeNode[];
}

export interface INextStepSuggestionsResponse {
  status: 'success' | 'error';
  suggestions: ISuggestion[];
  metadata: {
    source: string;
    contextReceived: boolean;
  };
}

interface INextStepSuggestionsBackendResponse {
  status: 'success' | 'error';
  suggestions: IBackendSuggestion[];
  metadata?: {
    source?: string;
    contextReceived?: boolean;
  };
}

export interface ITreeNode {
  id: string;
  cellIndex: number;
  cellType: string;
  summary?: string;
  parentId?: string;
}

export interface ISelectSuggestionResponse {
  status: 'success' | 'error';
  suggestion: ISuggestion;
  message: string;
  metadata: {
    source: string;
  };
}

export interface ISelectSuggestionContext {
  previousCells: ICellDescriptor[];
  nextCells: ICellDescriptor[];
}

// ── LLM 配置相关接口（对齐后端 llm-config endpoint）──────────────────

export interface ILLMConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  timeoutS: number;
  maxTokens: number;
  temperature: number;
}

export interface ILLMConfigResponse {
  status: 'success' | 'error';
  config: ILLMConfig;
  availableProviders: string[];
  message: string;
}

export interface ILLMConfigUpdate {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutS?: number;
  maxTokens?: number;
  temperature?: number;
}

// 2. 定义 api functions

export async function summarizeCell(
  serverSettings: ServerConnection.ISettings,
  cell: ICellDescriptor
): Promise<ICellSummaryResponse> {
  const response = await requestAPI<ICellSummaryResponse>(
    'summarize-cell',
    serverSettings,
    {
      method: 'POST',
      body: JSON.stringify(cell)
    }
  );

  if (response.status === 'error') {
    throw new Error('Server returned an error while summarizing the cell.');
  }

  return response;
}

export async function suggestNextSteps(
  serverSettings: ServerConnection.ISettings,
  selectedCell: ICellDescriptor,
  context: INextStepContext
): Promise<INextStepSuggestionsResponse> {
  const requestBody = {
    selectedCell,
    context
  };

  const requestConfig = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  };

  console.log('========== HTTP REQUEST ==========');
  console.log('Endpoint:', 'suggest-next-steps');
  console.log('Method:', requestConfig.method);
  console.log('Headers:', requestConfig.headers);
  console.log('Body:', JSON.stringify(requestBody, null, 2));
  console.log('Server Settings:', serverSettings);
  console.log('==================================');

  const response = await requestAPI<INextStepSuggestionsBackendResponse>(
    'suggest-next-steps',
    serverSettings,
    {
      method: 'POST',
      body: JSON.stringify({
        selectedCell,
        context
      })
    }
  );

  if (response.status === 'error') {
    throw new Error('Server returned an error while suggesting next steps.');
  }

  return normalizeSuggestionsResponse(response);
}

export async function selectSuggestion(
  serverSettings: ServerConnection.ISettings,
  selectedCell: ICellDescriptor,
  selectedSuggestion: ISuggestion,
  context?: ISelectSuggestionContext
): Promise<ISelectSuggestionResponse> {
  const response = await requestAPI<ISelectSuggestionResponse>(
    'select-suggestion',
    serverSettings,
    {
      method: 'POST',
      body: JSON.stringify({
        selectedCell,
        selectedSuggestion,
        context: context ?? { previousCells: [], nextCells: [] }
      })
    }
  );

  if (response.status === 'error') {
    throw new Error('Server returned an error while selecting suggestion.');
  }

  return response;
}

// ── LLM 配置 API ────────────────────────────────────────────────────

/**
 * GET /ai-assistant-extension/llm-config
 */
export async function getLLMConfig(
  serverSettings: ServerConnection.ISettings
): Promise<ILLMConfigResponse> {
  return requestAPI<ILLMConfigResponse>('llm-config', serverSettings, {
    method: 'GET'
  });
}

/**
 * POST /ai-assistant-extension/llm-config
 */
export async function setLLMConfig(
  serverSettings: ServerConnection.ISettings,
  config: ILLMConfigUpdate
): Promise<ILLMConfigResponse> {
  return requestAPI<ILLMConfigResponse>('llm-config', serverSettings, {
    method: 'POST',
    body: JSON.stringify(config)
  });
}

function normalizeSuggestionsResponse(
  response: INextStepSuggestionsBackendResponse
): INextStepSuggestionsResponse {
  const metadata = {
    source: response.metadata?.source ?? 'llm',
    contextReceived: response.metadata?.contextReceived ?? false
  };

  return {
    status: response.status,
    suggestions: response.suggestions.map((suggestion, index) =>
      normalizeSuggestion(suggestion, index, metadata.source)
    ),
    metadata
  };
}

function normalizeSuggestion(
  suggestion: IBackendSuggestion,
  index: number,
  metadataSource: string
): ISuggestion {
  const fallbackTitle = `Suggestion ${index + 1}`;
  const title = normalizeText(
    suggestion.title ?? suggestion.description,
    fallbackTitle
  );
  const description = normalizeText(suggestion.description, title);
  const cellType = normalizeText(suggestion.cellType, 'code');
  const content = normalizeText(suggestion.content, '');

  return {
    id: normalizeText(suggestion.id, `suggestion-${index + 1}`),
    title,
    description,
    cellType,
    content,
    metadata: {
      source: normalizeText(suggestion.metadata?.source, metadataSource)
    }
  };
}

function normalizeText(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}
