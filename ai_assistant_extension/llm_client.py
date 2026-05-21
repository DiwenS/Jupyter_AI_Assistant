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

LLM_TIMEOUT_S = int(
    os.getenv("AI_ASSISTANT_LLM_TIMEOUT_S", "120")
)

LLM_MAX_TOKENS = int(
    os.getenv("AI_ASSISTANT_LLM_MAX_TOKENS", "512")
)

LLM_TEMPERATURE = float(
    os.getenv("AI_ASSISTANT_LLM_TEMPERATURE", "0.2")
)


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
    Parameters
    ----------
    messages : list
        Chat messages in OpenAI format.
    temperature : float, optional
        Sampling temperature.
    max_tokens : int, optional
        Maximum output tokens.
    Returns
    -------
    str
        Generated text response.
    """
    if LLM_PROVIDER != "ollama":
        raise ValueError(f"Unsupported provider: {LLM_PROVIDER}")

    url = f"{LLM_BASE_URL}/api/chat"
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": (
                temperature
                if temperature is not None
                else LLM_TEMPERATURE
            ),
            "num_predict": (
                max_tokens
                if max_tokens is not None
                else LLM_MAX_TOKENS
            ),
        },
    }

    try:
        response = requests.post(
            url,
            json=payload,
            timeout=LLM_TIMEOUT_S,
        )
    except requests.exceptions.ConnectionError as e:
        raise LLMConnectionError(
            f"Could not connect to LLM service at {LLM_BASE_URL}"
        ) from e
    except requests.exceptions.Timeout as e:
        raise LLMError(
            f"LLM request timed out after {LLM_TIMEOUT_S} seconds"
        ) from e
    except requests.exceptions.RequestException as e:
        raise LLMError(
            f"Unexpected request error: {str(e)}"
        ) from e

    # HTTP status validation
    if response.status_code != 200:
        raise LLMResponseError(
            f"LLM returned status {response.status_code}: {response.text}"
        )

    # Parse JSON
    try:
        data = response.json()
    except Exception as e:
        raise LLMResponseError(
            f"Invalid JSON response: {response.text}"
        ) from e
    # Extract content
    try:
        content = data["message"]["content"]
    except KeyError as e:
        raise LLMResponseError(
            f"Unexpected response structure: {data}"
        ) from e
    return content.strip()


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