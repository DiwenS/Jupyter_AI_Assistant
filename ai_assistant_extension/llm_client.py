# import requests
#
# response = requests.post(
#     "http://localhost:11434/api/chat",
#     json={
#         "model": "qwen3:8b",
#         "messages": [
#             {
#                 "role": "user",
#                 "content": "hello"
#             }
#         ],
#         "stream": False
#     }
# )
#
# print(response.json())


import os
import requests
from typing import List, Dict, Optional


class LLMError(Exception):
    """LLM 错误的基本异常。"""
    pass


class LLMConnectionError(LLMError):
    """当无法访问 LLM 服务时引发。"""
    pass


class LLMResponseError(LLMError):
    """当 LLM 响应无效时引发。"""
    pass

# =========================
# Environment Configuration
# =========================

LLM_PROVIDER = os.getenv("AI_ASSISTANT_LLM_PROVIDER", "ollama")
LLM_BASE_URL = os.getenv(
    "AI_ASSISTANT_LLM_BASE_URL",
    "http://localhost:11434"
)
LLM_MODEL = os.getenv(
    "AI_ASSISTANT_LLM_MODEL",
    "qwen3:8b"
)

LLM_API_KEY = os.getenv(
    "AI_ASSISTANT_LLM_API_KEY", ""
)

LLM_TIMEOUT_S = int(
    os.getenv("AI_ASSISTANT_LLM_TIMEOUT_S", "120")
)

LLM_MAX_TOKENS = int(
    os.getenv("AI_ASSISTANT_LLM_MAX_TOKENS", "2048")
)

LLM_TEMPERATURE = float(
    os.getenv("AI_ASSISTANT_LLM_TEMPERATURE", "0.2")
)

_RUNTIME_LLM_CONFIG = {
    "provider": LLM_PROVIDER,
    "baseUrl": LLM_BASE_URL,
    "model": LLM_MODEL,
    "apiKey": LLM_API_KEY,
    "timeoutS": LLM_TIMEOUT_S,
    "maxTokens": LLM_MAX_TOKENS,
    "temperature": LLM_TEMPERATURE,
}

SUPPORTED_PROVIDERS = [
    "ollama",
    "openai-compatible",
    "anthropic",
]

def _public_config(config: Dict) -> Dict:
    """
    Return a frontend-safe copy of the config.

    Important: never expose the raw API key to the frontend.
    The frontend only needs to know whether a key is configured.
    """
    public = dict(config)
    api_key = public.pop("apiKey", "")
    public["apiKeyConfigured"] = bool(api_key)
    return public

def get_llm_config():
    """
    Return the currently active LLM configuration.

    The returned config is safe for frontend display and does not include
    the raw API key.
    """
    return _public_config(_RUNTIME_LLM_CONFIG)

def _get_internal_llm_config():
    """
    Return the full internal config, including apiKey.

    Only backend LLM calls should use this function.
    """
    return dict(_RUNTIME_LLM_CONFIG)

def update_llm_config(config):
    """
    Update the runtime LLM configuration.

    This allows the frontend to change provider/model/baseUrl without
    restarting the Jupyter server.
    """
    if not isinstance(config, dict):
        raise ValueError("LLM config must be a dictionary.")

    allowed_keys = {
        "provider",
        "baseUrl",
        "model",
        "apiKey",
        "timeoutS",
        "maxTokens",
        "temperature",
    }

    for key, value in config.items():
        if key not in allowed_keys:
            continue

        if value is None or value == "":
            continue

        if key in {"timeoutS", "maxTokens"}:
            _RUNTIME_LLM_CONFIG[key] = int(value)
        elif key == "temperature":
            _RUNTIME_LLM_CONFIG[key] = float(value)
        else:
            _RUNTIME_LLM_CONFIG[key] = str(value)

    provider = _RUNTIME_LLM_CONFIG.get("provider", "ollama")
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(
            f"Unsupported provider: {provider}. "
            f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}"
        )

    return get_llm_config()

def _join_url(base_url: str, path: str) -> str:
    """
    Join base URL and API path safely.
    """
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"

def _clean_code_fences(text: str) -> str:
    """
    Remove simple markdown code fences from model output.

    Some models ignore the prompt instruction and still return:
    ```python
    ...
    ```
    This cleanup keeps generated code cells executable.
    """
    stripped = text.strip()

    if stripped.startswith("```"):
        lines = stripped.splitlines()

        # Remove first fence, e.g. ```python or ```
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]

        # Remove last fence
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]

        return "\n".join(lines).strip()

    return stripped

# =========================
# Provider Implementations
# =========================

def _generate_with_ollama(
    messages: List[Dict[str, str]],
    config: Dict,
    temperature: Optional[float],
    max_tokens: Optional[int],
) -> str:
    base_url = config.get("baseUrl", "http://localhost:11434")
    model = config.get("model", "qwen3:8b")
    timeout_s = int(config.get("timeoutS", 120))
    max_tokens_value = int(config.get("maxTokens", 2048))
    temperature_value = float(config.get("temperature", 0.2))

    url = _join_url(base_url, "/api/chat")
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": (
                temperature
                if temperature is not None
                else temperature_value
            ),
            "num_predict": (
                max_tokens
                if max_tokens is not None
                else max_tokens_value
            ),
        },
    }

    print("[LLM] provider: ollama")
    print("[LLM] model:", model)
    print("[LLM] payload size:", len(str(payload)))

    try:
        response = requests.post(
            url,
            json=payload,
            timeout=timeout_s,
        )
    except requests.exceptions.ConnectionError as e:
        raise LLMConnectionError(
            f"Could not connect to Ollama service at {base_url}"
        ) from e
    except requests.exceptions.Timeout as e:
        raise LLMError(
            f"Ollama request timed out after {timeout_s} seconds"
        ) from e
    except requests.exceptions.RequestException as e:
        raise LLMError(
            f"Unexpected Ollama request error: {str(e)}"
        ) from e

    print("[LLM] response code:", response.status_code)

    if response.status_code != 200:
        raise LLMResponseError(
            f"Ollama returned status {response.status_code}: {response.text}"
        )

    try:
        data = response.json()
        content = data["message"]["content"]
    except Exception as e:
        raise LLMResponseError(
            f"Unexpected Ollama response structure: {response.text}"
        ) from e

    return _clean_code_fences(content)

def _generate_with_openai_compatible(
    messages: List[Dict[str, str]],
    config: Dict,
    temperature: Optional[float],
    max_tokens: Optional[int],
) -> str:
    base_url = config.get("baseUrl", "https://api.openai.com/v1")
    model = config.get("model", "")
    api_key = config.get("apiKey", "")
    timeout_s = int(config.get("timeoutS", 120))
    max_tokens_value = int(config.get("maxTokens", 2048))
    temperature_value = float(config.get("temperature", 0.2))

    if not api_key:
        raise LLMError("Missing API key for openai-compatible provider.")

    if not model:
        raise LLMError("Missing model for openai-compatible provider.")

    url = _join_url(base_url, "/chat/completions")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": (
            temperature
            if temperature is not None
            else temperature_value
        ),
        "max_tokens": (
            max_tokens
            if max_tokens is not None
            else max_tokens_value
        ),
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    print("[LLM] provider: openai-compatible")
    print("[LLM] model:", model)
    print("[LLM] payload size:", len(str(payload)))

    try:
        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=timeout_s,
        )
    except requests.exceptions.ConnectionError as e:
        raise LLMConnectionError(
            f"Could not connect to OpenAI-compatible service at {base_url}"
        ) from e
    except requests.exceptions.Timeout as e:
        raise LLMError(
            f"OpenAI-compatible request timed out after {timeout_s} seconds"
        ) from e
    except requests.exceptions.RequestException as e:
        raise LLMError(
            f"Unexpected OpenAI-compatible request error: {str(e)}"
        ) from e

    print("[LLM] response code:", response.status_code)

    if response.status_code != 200:
        raise LLMResponseError(
            "OpenAI-compatible provider returned "
            f"status {response.status_code}: {response.text}"
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except Exception as e:
        raise LLMResponseError(
            f"Unexpected OpenAI-compatible response structure: {response.text}"
        ) from e

    return _clean_code_fences(content)

def _convert_messages_for_anthropic(messages: List[Dict[str, str]]):
    """
    Convert OpenAI-style messages to Anthropic Messages API format.

    Anthropic uses a top-level 'system' field instead of system-role messages.
    """
    system_parts = []
    anthropic_messages = []

    for message in messages:
        role = message.get("role", "")
        content = message.get("content", "")

        if role == "system":
            system_parts.append(content)
        elif role in {"user", "assistant"}:
            anthropic_messages.append({
                "role": role,
                "content": content,
            })
        else:
            # Unknown roles are treated as user messages.
            anthropic_messages.append({
                "role": "user",
                "content": content,
            })

    system_prompt = "\n\n".join(system_parts).strip()

    return system_prompt, anthropic_messages

def _generate_with_anthropic(
    messages: List[Dict[str, str]],
    config: Dict,
    temperature: Optional[float],
    max_tokens: Optional[int],
) -> str:
    base_url = config.get("baseUrl", "https://api.anthropic.com")
    model = config.get("model", "")
    api_key = config.get("apiKey", "")
    timeout_s = int(config.get("timeoutS", 120))
    max_tokens_value = int(config.get("maxTokens", 2048))
    temperature_value = float(config.get("temperature", 0.2))

    if not api_key:
        raise LLMError("Missing API key for anthropic provider.")

    if not model:
        raise LLMError("Missing model for anthropic provider.")

    system_prompt, anthropic_messages = _convert_messages_for_anthropic(
        messages
    )

    url = _join_url(base_url, "/v1/messages")
    payload = {
        "model": model,
        "messages": anthropic_messages,
        "max_tokens": (
            max_tokens
            if max_tokens is not None
            else max_tokens_value
        ),
        "temperature": (
            temperature
            if temperature is not None
            else temperature_value
        ),
    }

    if system_prompt:
        payload["system"] = system_prompt

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    print("[LLM] provider: anthropic")
    print("[LLM] model:", model)
    print("[LLM] payload size:", len(str(payload)))

    try:
        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=timeout_s,
        )
    except requests.exceptions.ConnectionError as e:
        raise LLMConnectionError(
            f"Could not connect to Anthropic service at {base_url}"
        ) from e
    except requests.exceptions.Timeout as e:
        raise LLMError(
            f"Anthropic request timed out after {timeout_s} seconds"
        ) from e
    except requests.exceptions.RequestException as e:
        raise LLMError(
            f"Unexpected Anthropic request error: {str(e)}"
        ) from e

    print("[LLM] response code:", response.status_code)

    if response.status_code != 200:
        raise LLMResponseError(
            f"Anthropic returned status {response.status_code}: {response.text}"
        )

    try:
        data = response.json()
        content_blocks = data.get("content", [])
        text_parts = [
            block.get("text", "")
            for block in content_blocks
            if block.get("type") == "text"
        ]
        content = "\n".join(text_parts).strip()
    except Exception as e:
        raise LLMResponseError(
            f"Unexpected Anthropic response structure: {response.text}"
        ) from e

    if not content:
        raise LLMResponseError(
            f"Anthropic returned empty text content: {response.text}"
        )

    return _clean_code_fences(content)

# =========================
# Main Generate Function
# =========================

def generate(
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
) -> str:
    """
    Generate text from the configured LLM.

    Supported providers:
    - ollama
    - openai-compatible
    - anthropic
    """
    config = _get_internal_llm_config()
    provider = config.get("provider", "ollama")

    if provider == "ollama":
        return _generate_with_ollama(
            messages=messages,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    
    if provider == "openai-compatible":
        return _generate_with_openai_compatible(
            messages=messages,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    
    if provider == "anthropic":
        return _generate_with_anthropic(
            messages=messages,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    raise ValueError(
        f"Unsupported provider: {provider}. "
        f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}"
    )


# =========================
# Simple Test
# =========================
if __name__ == "__main__":
    test_messages = [
        {
            "role": "system",
            "content": "You are a helpful Jupyter notebook assistant."
        },
        {
            "role": "user",
            "content": "Summarize what pandas is."
        }
    ]
    try:
        result = generate(test_messages)
        print("\n=== MODEL RESPONSE ===\n")
        print(result)
    except Exception as e:
        print("\n=== ERROR ===\n")
        print(str(e))