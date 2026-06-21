/**
 * LLM Settings Panel
 *
 * 对齐后端 llm-config 接口。
 * Provider: ollama / openai-compatible / anthropic
 * Config keys: camelCase (baseUrl, apiKey, timeoutS, maxTokens, temperature)
 */

import { ServerConnection } from '@jupyterlab/services';
import { getLLMConfig, setLLMConfig } from './api';

// 各 provider 的默认值
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen3:8b'
  },
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514'
  }
};

/**
 * 返回设置面板的 HTML
 */
export function createSettingsHTML(): string {
  return `
    <details id="llm-settings-panel" class="jp-ai-settings">
      <summary class="jp-ai-settings-toggle">
        &#9881; LLM Settings
      </summary>

      <div class="jp-ai-settings-body">
        <label class="jp-ai-settings-label">
          Provider
          <select id="llm-provider" class="jp-ai-settings-input">
            <option value="ollama">Ollama (Local)</option>
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </label>

        <label class="jp-ai-settings-label" id="llm-apikey-label">
          API Key
          <input id="llm-api-key" type="password" class="jp-ai-settings-input"
                 placeholder="sk-... or sk-ant-..." />
        </label>

        <label class="jp-ai-settings-label">
          Model
          <input id="llm-model" type="text" class="jp-ai-settings-input"
                 placeholder="e.g. gpt-4o-mini" />
        </label>

        <label class="jp-ai-settings-label">
          Base URL
          <input id="llm-base-url" type="text" class="jp-ai-settings-input"
                 placeholder="e.g. https://api.openai.com/v1" />
        </label>

        <div class="jp-ai-settings-actions">
          <button id="llm-save-config" class="jp-ai-settings-btn">
            Save
          </button>
          <span id="llm-config-status" class="jp-ai-settings-status"></span>
        </div>
      </div>
    </details>
  `;
}

/**
 * 返回设置面板的 CSS
 */
export function createSettingsCSS(): string {
  return `
    .jp-ai-settings {
      margin: 4px 0 8px 0;
      border: 1px solid var(--jp-border-color1, #ddd);
      border-radius: 4px;
      font-size: 12px;
    }
    .jp-ai-settings-toggle {
      cursor: pointer;
      padding: 6px 8px;
      font-weight: 600;
      user-select: none;
      color: var(--jp-ui-font-color0, #333);
      background: var(--jp-layout-color2, #f5f5f5);
      border-radius: 4px;
    }
    .jp-ai-settings-toggle:hover {
      background: var(--jp-layout-color3, #eee);
    }
    .jp-ai-settings-body {
      padding: 8px;
      overflow: hidden;
    }
    .jp-ai-settings-label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      color: var(--jp-ui-font-color1, #555);
    }
    .jp-ai-settings-input {
      display: block;
      width: 100%;
      margin-top: 2px;
      padding: 4px 6px;
      border: 1px solid var(--jp-border-color1, #ccc);
      border-radius: 3px;
      font-size: 12px;
      background: var(--jp-layout-color0, #fff);
      color: var(--jp-ui-font-color0, #333);
      box-sizing: border-box;
    }
    .jp-ai-settings-input:focus {
      outline: none;
      border-color: var(--jp-brand-color1, #2196f3);
    }
    .jp-ai-settings-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    .jp-ai-settings-btn {
      padding: 4px 16px;
      border: none;
      border-radius: 3px;
      background: var(--jp-brand-color1, #2196f3);
      color: white;
      font-size: 12px;
      cursor: pointer;
    }
    .jp-ai-settings-btn:hover {
      opacity: 0.9;
    }
    .jp-ai-settings-status {
      font-size: 11px;
      color: var(--jp-ui-font-color2, #888);
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
      white-space: nowrap;
    }
  `;
}

/**
 * 绑定设置面板事件
 */
export function bindSettingsEvents(
  panelNode: HTMLElement,
  serverSettings: ServerConnection.ISettings
): void {
  const providerSelect = panelNode.querySelector(
    '#llm-provider'
  ) as HTMLSelectElement;
  const apiKeyInput = panelNode.querySelector(
    '#llm-api-key'
  ) as HTMLInputElement;
  const apiKeyLabel = panelNode.querySelector(
    '#llm-apikey-label'
  ) as HTMLElement;
  const modelInput = panelNode.querySelector('#llm-model') as HTMLInputElement;
  const baseUrlInput = panelNode.querySelector(
    '#llm-base-url'
  ) as HTMLInputElement;
  const saveButton = panelNode.querySelector(
    '#llm-save-config'
  ) as HTMLButtonElement;
  const statusSpan = panelNode.querySelector(
    '#llm-config-status'
  ) as HTMLSpanElement;

  if (!providerSelect || !saveButton) {
    return;
  }

  // 切换 provider 时自动填充默认值
  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    const defaults = PROVIDER_DEFAULTS[provider];
    if (defaults) {
      modelInput.value = defaults.model;
      baseUrlInput.value = defaults.baseUrl;
    }
    // Ollama 不需要 API Key
    apiKeyLabel.style.display = provider === 'ollama' ? 'none' : 'block';
    apiKeyInput.value = '';
  });

  // 保存按钮
  saveButton.addEventListener('click', async () => {
    statusSpan.textContent = 'Saving...';
    statusSpan.style.color = '';

    try {
      const update: Record<string, any> = {
        provider: providerSelect.value,
        model: modelInput.value,
        baseUrl: baseUrlInput.value
      };

      // 只在用户填写了 API Key 时才发送
      if (apiKeyInput.value.trim()) {
        (update as any).apiKey = apiKeyInput.value.trim();
      }

      const resp = await setLLMConfig(serverSettings, update);
      statusSpan.textContent = '\u2713 ' + (resp.message || 'Saved!');
      statusSpan.style.color = 'green';
      apiKeyInput.value = '';
      apiKeyInput.placeholder = resp.config.apiKeyConfigured
        ? '(API Key configured)'
        : 'sk-... or sk-ant-...';
    } catch (e: any) {
      const msg = String(e.message || 'Failed');
      statusSpan.textContent =
        '\u2717 ' + (msg.length > 80 ? msg.slice(0, 80) + '...' : msg);
      statusSpan.style.color = 'red';
    }
  });

  // 初始加载当前配置
  void loadCurrentConfig(serverSettings, panelNode);
}

/**
 * 从后端加载当前配置并填充表单
 */
async function loadCurrentConfig(
  serverSettings: ServerConnection.ISettings,
  panelNode: HTMLElement
): Promise<void> {
  try {
    const resp = await getLLMConfig(serverSettings);
    const cfg = resp.config;

    const providerSelect = panelNode.querySelector(
      '#llm-provider'
    ) as HTMLSelectElement;
    const apiKeyLabel = panelNode.querySelector(
      '#llm-apikey-label'
    ) as HTMLElement;
    const apiKeyInput = panelNode.querySelector(
      '#llm-api-key'
    ) as HTMLInputElement;
    const modelInput = panelNode.querySelector(
      '#llm-model'
    ) as HTMLInputElement;
    const baseUrlInput = panelNode.querySelector(
      '#llm-base-url'
    ) as HTMLInputElement;
    const statusSpan = panelNode.querySelector(
      '#llm-config-status'
    ) as HTMLSpanElement;

    providerSelect.value = cfg.provider;
    modelInput.value = cfg.model;
    baseUrlInput.value = cfg.baseUrl;

    // Ollama 不显示 API Key 输入框
    apiKeyLabel.style.display = cfg.provider === 'ollama' ? 'none' : 'block';
    apiKeyInput.placeholder = cfg.apiKeyConfigured
      ? '(API Key configured)'
      : 'sk-... or sk-ant-...';

    statusSpan.textContent = 'Provider: ' + cfg.provider;
  } catch (e: any) {
    const statusSpan = panelNode.querySelector(
      '#llm-config-status'
    ) as HTMLSpanElement;
    if (statusSpan) {
      statusSpan.textContent = 'Config load failed';
      statusSpan.style.color = 'orange';
    }
    console.warn('[AI Assistant] Could not load LLM config:', e);
  }
}
