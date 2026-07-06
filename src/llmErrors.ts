// LLM 错误处理：把后端统一的错误对象解析成前端可直接展示的友好信息。
//
// 后端（llm_client.classify_llm_error / routes._finish_llm_error）在 LLM 调用
// 失败时返回：
//   HTTP 4xx / 5xx
//   {
//     "status": "error",
//     "message": "给用户看的原始文案",
//     "error": {
//       "code": "TOKEN_PARAMETER_MISMATCH",
//       "type": "config",
//       "message": "原始异常信息",
//       "provider": "openai-compatible",
//       "model": "gpt-4o",
//       "retriable": false
//     }
//   }
//
// 本模块负责：把上面的结构接住（AssistantLLMError），并映射成中文标题 + 建议动作。

// 后端目前会返回的稳定错误码，与 llm_client.py 中保持一致。
export type LLMErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY_FORMAT'
  | 'INVALID_API_KEY'
  | 'UNSUPPORTED_PROVIDER'
  | 'MODEL_NOT_FOUND'
  | 'TOKEN_PARAMETER_MISMATCH'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'CONNECTION_ERROR'
  | 'LLM_RESPONSE_ERROR'
  | 'LLM_ERROR';

// 后端 error 对象的形状。
export interface ILLMErrorInfo {
  code: LLMErrorCode | string;
  type: string;
  message: string;
  provider?: string;
  model?: string;
  retriable?: boolean;
}

// 展示时的建议后续动作：跳到设置面板 / 允许重试 / 无动作。
export type LLMErrorAction = 'open-settings' | 'retry' | 'none';

// 每个错误码对应的前端展示信息。
export interface ILLMErrorPresentation {
  title: string; // 简短标题
  message: string; // 给用户看的解释文案
  action: LLMErrorAction; // 建议动作
}

// 携带结构化错误信息的异常。前端各处 catch 到它即可拿到 code / retriable 等。
export class AssistantLLMError extends Error {
  readonly info: ILLMErrorInfo;
  readonly httpStatus?: number;

  constructor(info: ILLMErrorInfo, httpStatus?: number) {
    super(info.message || info.code || 'LLM error');
    this.name = 'AssistantLLMError';
    this.info = info;
    this.httpStatus = httpStatus;
    // 修正原型链，保证 instanceof 在编译到 ES5 时也可用。
    Object.setPrototypeOf(this, AssistantLLMError.prototype);
  }
}

// 错误码 -> 中文展示信息映射表。
const PRESENTATIONS: Record<string, ILLMErrorPresentation> = {
  MISSING_API_KEY: {
    title: 'Missing API key',
    message:
      'The current provider requires an API key, but none is configured. Please add your API key in Settings.',
    action: 'open-settings'
  },
  INVALID_API_KEY_FORMAT: {
    title: 'Invalid API key format',
    message:
      'The API key format is invalid (it may contain non-ASCII characters, spaces, or illegal symbols). Please paste a valid key.',
    action: 'open-settings'
  },
  INVALID_API_KEY: {
    title: 'Invalid API key',
    message:
      'The API key is invalid or expired (authentication failed, 401). Please check that the key is correct and still has access.',
    action: 'open-settings'
  },
  UNSUPPORTED_PROVIDER: {
    title: 'Unsupported provider',
    message:
      'The current provider is not supported. Please choose Ollama, OpenAI-compatible, or Anthropic in Settings.',
    action: 'open-settings'
  },
  MODEL_NOT_FOUND: {
    title: 'Model not found',
    message:
      'The specified model does not exist or the name is incorrect. Please check the model name in Settings.',
    action: 'open-settings'
  },
  TOKEN_PARAMETER_MISMATCH: {
    title: 'Parameter not supported',
    message:
      'The current model does not support the token parameter in use (e.g. max_tokens / max_completion_tokens). ' +
      'This value is controlled by the backend default; please contact the maintainer to adjust the backend configuration.',
    action: 'none'
  },
  RATE_LIMIT: {
    title: 'Rate limited',
    message:
      'Too many requests; the request was rate limited (429). Please wait a moment and retry.',
    action: 'retry'
  },
  TIMEOUT: {
    title: 'Request timed out',
    message:
      'Timed out waiting for the LLM response. Please check your network or retry.',
    action: 'retry'
  },
  CONNECTION_ERROR: {
    title: 'Connection failed',
    message:
      'Could not connect to the LLM service. Please make sure the endpoint is reachable (e.g. that local Ollama is running).',
    action: 'retry'
  },
  LLM_RESPONSE_ERROR: {
    title: 'Invalid response',
    message:
      'The LLM returned a response that could not be parsed. Please retry or switch models.',
    action: 'retry'
  },
  LLM_ERROR: {
    title: 'Request failed',
    message: 'An unknown error occurred while calling the LLM.',
    action: 'none'
  }
};

// 未知错误码的兜底展示。
const FALLBACK: ILLMErrorPresentation = {
  title: 'Something went wrong',
  message: 'An unexpected error occurred.',
  action: 'none'
};

// 根据错误码取展示信息；未知码回落到兜底。
export function presentLLMError(info: ILLMErrorInfo): ILLMErrorPresentation {
  const base = PRESENTATIONS[info.code] ?? FALLBACK;

  // retriable 由后端权威给出：即便映射表默认 none，只要后端说可重试就允许重试。
  const action: LLMErrorAction =
    info.retriable && base.action === 'none' ? 'retry' : base.action;

  return { ...base, action };
}

// 把任意 catch 到的异常统一转成 ILLMErrorInfo，供展示使用。
// - AssistantLLMError：直接取 info。
// - 其它 Error / 未知：包装成 LLM_ERROR。
export function toLLMErrorInfo(err: unknown): ILLMErrorInfo {
  if (err instanceof AssistantLLMError) {
    return err.info;
  }
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
  return { code: 'LLM_ERROR', type: 'llm', message, retriable: false };
}

// 从后端响应体解析出 AssistantLLMError。
// body 形如 { status, message, error: {...} }；error 缺失时用顶层 message 兜底。
export function parseLLMError(body: any, httpStatus?: number): AssistantLLMError {
  const raw = body && typeof body === 'object' ? body : {};
  const info: ILLMErrorInfo =
    raw.error && typeof raw.error === 'object'
      ? {
          code: raw.error.code ?? 'LLM_ERROR',
          type: raw.error.type ?? 'llm',
          message: raw.error.message ?? raw.message ?? 'LLM error',
          provider: raw.error.provider,
          model: raw.error.model,
          retriable: Boolean(raw.error.retriable)
        }
      : {
          code: 'LLM_ERROR',
          type: 'llm',
          message: raw.message ?? 'LLM error',
          retriable: false
        };
  return new AssistantLLMError(info, httpStatus);
}
