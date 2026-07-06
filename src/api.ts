import { ServerConnection } from '@jupyterlab/services';

import { requestAPI } from './request';
import { parseLLMError } from './llmErrors';

// 1. 定义接口

// 描述cell的基本信息
export interface ICellDescriptor {
  cellId: string;
  cellIndex: number;
  cellType: string;
  source: string;
  title?: string;
  summary?: string; //？表示可选
}

// 描述后端接口summarize-cell返回的cell summary数据
export interface ICellSummaryData {
  title: string;
  summary: string;
}

export interface ICellSummaryResponse {
  status: 'success' | 'error';
  cellId: string;
  cellIndex: number | null;
  cellType: string;
  title?: string;
  summary?: string;
  details: string;
  metadata: {
    source: string;
  };
}

//一条suggestion的基本信息
export interface ISuggestion {
  id: string;
  key?: string;
  title: string;
  description: string;
  cellType: string;
  content?: string;
  source?: string;
  generated?: {
    status: 'yes' | 'no';
    cell_id?: string;
  };
  metadata: {
    source: string;
    [key: string]: unknown;
  };
}

export interface IContextSuggestion {
  title: string;
  cellType: string;
  generated: {
    status: 'yes' | 'no';
    cell_id?: string;
  };
}

//请求后端生成建议时，前端传给后端的上下文cell信息&Tree信息
export interface INextStepContext {
  previousCells: ICellDescriptor[];
  nextCells: ICellDescriptor[];
  tree: ITreeNode[];
  currentCellSuggestions: IContextSuggestion[];
}

//后端生成当前cell的建议后，返回给前端的完整suggestions
export interface INextStepSuggestionsResponse {
  status: 'success' | 'error';
  suggestions: ISuggestion[];
  metadata: {
    source: string;
    contextReceived: boolean;
  };
}

// Tree的每个Node
export interface ITreeNode {
  id: string;
  cellIndex: number;
  cellType: string;
  title?: string;
  summary?: string;
  isGenerated?: boolean;
  parentId: string; // 根节点下的 cell 使用 'ROOT' 作为 parentId。
  children?: ITreeNode[];
}

export interface ISelectSuggestionResponse {
  status: 'success' | 'error';
  suggestion: ISuggestion;
  message: string;
  metadata: {
    source: string;
  };
}

// 支持的 LLM provider，与后端 SUPPORTED_PROVIDERS 保持一致。
export type LLMProvider = 'ollama' | 'openai-compatible' | 'anthropic';

// 后端 GET/POST llm-config 返回的 config 部分（不包含真实 apiKey）。
export interface ILLMConfig {
  provider: LLMProvider;
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
  availableProviders: LLMProvider[];
  message: string;
}

// 前端发起更新请求时使用的字段。apiKey 留空表示不修改已保存的 key。
export interface ILLMConfigUpdate {
  provider?: LLMProvider;
  baseUrl?: string;
  model?: string;
  apikey?: string;
  timeoutS?: number;
  maxTokens?: number;
  temperature?: number;
}

//2. 定义api functions

//向后端summarize-cell请求当前cell的summary
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
    throw parseLLMError(response as any);
  }

  return response;
}

//
export async function suggestNextSteps(
  serverSettings: ServerConnection.ISettings,
  selectedCell: ICellDescriptor,
  context: INextStepContext
): Promise<INextStepSuggestionsResponse> {
  // 构造 request body
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

  const response = await requestAPI<INextStepSuggestionsResponse>(
    'suggest-next-steps',
    serverSettings,
    {
      method: 'POST',
      body: JSON.stringify(requestBody)
    }
  );

  if (response.status === 'error') {
    throw parseLLMError(response as any);
  }

  return response;
}

//告诉后端用户选中了哪一条suggetion
export async function selectSuggestion(
  serverSettings: ServerConnection.ISettings,
  selectedCell: ICellDescriptor,
  selectedSuggestion: ISuggestion,
  context: INextStepContext
): Promise<ISelectSuggestionResponse> {
  const requestBody = {
    selectedCell,
    selectedSuggestion,
    context
  };

  console.log('========== HTTP REQUEST ==========');
  console.log('Endpoint:', 'select-suggestion');
  console.log('Method:', 'POST');
  console.log('Body:', JSON.stringify(requestBody, null, 2));
  console.log('Server Settings:', serverSettings);
  console.log('==================================');

  const response = await requestAPI<ISelectSuggestionResponse>(
    'select-suggestion',
    serverSettings,
    {
      method: 'POST',
      body: JSON.stringify(requestBody)
    }
  );

  if (response.status === 'error') {
    throw parseLLMError(response as any);
  }

  return response;
}

// 获取当前后端的 LLM 配置（provider / model / baseUrl 等，不含真实 apiKey）。
export async function getLLMConfig(
  serverSettings: ServerConnection.ISettings
): Promise<ILLMConfigResponse> {
  const response = await requestAPI<ILLMConfigResponse>(
    'llm-config',
    serverSettings,
    {
      method: 'GET'
    }
  );

  if (response.status === 'error') {
    throw parseLLMError(response as any);
  }

  return response;
}

// 更新后端的 LLM 配置。update 中未提供或为空字符串的字段，后端会保持原值不变
// （apikey 留空即表示不修改已保存的 key）。
export async function updateLLMConfig(
  serverSettings: ServerConnection.ISettings,
  update: ILLMConfigUpdate
): Promise<ILLMConfigResponse> {
  const response = await requestAPI<ILLMConfigResponse>(
    'llm-config',
    serverSettings,
    {
      method: 'POST',
      body: JSON.stringify(update)
    }
  );

  if (response.status === 'error') {
    throw parseLLMError(response as any);
  }

  return response;
}
