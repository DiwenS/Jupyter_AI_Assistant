// LLM 错误的前端展示：一个自绘的浮层 toast（右下角），不依赖 @jupyterlab/apputils。
//
// 用法：
//   import { showLLMError } from './errorDisplay';
//   try { ... } catch (err) {
//     showLLMError(err, {
//       onOpenSettings: () => this.openSettingsPanel(),
//       onRetry: () => this.retryLastAction()
//     });
//   }

import {
  toLLMErrorInfo,
  presentLLMError,
  ILLMErrorInfo,
  LLMErrorAction
} from './llmErrors';

export interface IShowLLMErrorOptions {
  // action 为 'open-settings' 时，点击「打开设置」按钮的回调。
  onOpenSettings?: () => void;
  // action 为 'retry' 时，点击「重试」按钮的回调。
  onRetry?: () => void;
  // 覆盖默认标题（一般不需要）。
  titleOverride?: string;
  // 自动消失毫秒数；0 表示不自动消失，仅可手动关闭。默认 8000。
  autoCloseMs?: number;
}

// 所有 toast 共用一个容器，挂在 document.body 上，保证浮层不受面板布局影响。
let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) {
    return container;
  }
  container = document.createElement('div');
  container.className = 'jp-ai-assistant-toast-container';
  document.body.appendChild(container);
  return container;
}

function actionLabel(action: LLMErrorAction): string {
  switch (action) {
    case 'open-settings':
      return 'Open Settings';
    case 'retry':
      return 'Retry';
    default:
      return '';
  }
}

// 展示一个 LLM 错误 toast。err 可以是 AssistantLLMError，也可以是任意异常。
export function showLLMError(
  err: unknown,
  options: IShowLLMErrorOptions = {}
): void {
  const info: ILLMErrorInfo = toLLMErrorInfo(err);
  const presentation = presentLLMError(info);
  const root = ensureContainer();

  const toast = document.createElement('div');
  toast.className = 'jp-ai-assistant-toast jp-ai-assistant-toast-error';

  // 标题行：标题 + 关闭按钮
  const header = document.createElement('div');
  header.className = 'jp-ai-assistant-toast-header';

  const title = document.createElement('span');
  title.className = 'jp-ai-assistant-toast-title';
  title.textContent = options.titleOverride ?? presentation.title;
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'jp-ai-assistant-toast-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  header.appendChild(closeBtn);

  toast.appendChild(header);

  // 正文文案
  const body = document.createElement('div');
  body.className = 'jp-ai-assistant-toast-body';
  body.textContent = presentation.message;
  toast.appendChild(body);

  // provider / model 上下文（有才显示），方便定位问题。
  if (info.provider || info.model) {
    const meta = document.createElement('div');
    meta.className = 'jp-ai-assistant-toast-meta';
    const parts: string[] = [];
    if (info.provider) {
      parts.push(`Provider: ${info.provider}`);
    }
    if (info.model) {
      parts.push(`Model: ${info.model}`);
    }
    meta.textContent = parts.join(' · ');
    toast.appendChild(meta);
  }

  let timer: number | null = null;
  const dismiss = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (toast.parentElement) {
      toast.parentElement.removeChild(toast);
    }
    // 容器空了就移除，避免残留空节点。
    if (root.childElementCount === 0 && root.parentElement) {
      root.parentElement.removeChild(root);
      container = null;
    }
  };

  closeBtn.addEventListener('click', dismiss);

  // 动作按钮：打开设置 / 重试。
  const label = actionLabel(presentation.action);
  const handler =
    presentation.action === 'open-settings'
      ? options.onOpenSettings
      : presentation.action === 'retry'
        ? options.onRetry
        : undefined;

  if (label && handler) {
    const actions = document.createElement('div');
    actions.className = 'jp-ai-assistant-toast-actions';

    const actionBtn = document.createElement('button');
    actionBtn.className = 'jp-ai-assistant-toast-action';
    actionBtn.type = 'button';
    actionBtn.textContent = label;
    actionBtn.addEventListener('click', () => {
      dismiss();
      handler();
    });
    actions.appendChild(actionBtn);
    toast.appendChild(actions);
  }

  root.appendChild(toast);

  // 自动消失：默认 8s；可重试的错误保留久一点。action 需要用户操作时不建议太短。
  const autoCloseMs =
    options.autoCloseMs !== undefined ? options.autoCloseMs : 8000;
  if (autoCloseMs > 0) {
    timer = window.setTimeout(dismiss, autoCloseMs);
  }
}
