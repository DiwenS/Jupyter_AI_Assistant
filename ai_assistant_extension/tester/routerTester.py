import subprocess
import re
import requests
import json


# =========================
# 自动获取 Jupyter token
# =========================

def get_jupyter_token():
    try:
        # 执行命令
        result = subprocess.check_output(
            ["jupyter", "server", "list"],
            text=True
        )

        match = re.search(r"token=([a-zA-Z0-9]+)", result)

        if not match:
            raise RuntimeError("Could not find Jupyter token.")

        token = match.group(1)

        return token

    except Exception as e:
        print("Failed to get Jupyter token.")
        print(e)
        return None


# =========================
# 配置
# =========================

TOKEN = get_jupyter_token()

if TOKEN is None:
    raise RuntimeError("No Jupyter token found.")

BASE_URL = "http://localhost:8888/ai-assistant-extension"

HEADERS = {
    "Authorization": f"token {TOKEN}",
    "Content-Type": "application/json"
}


# =========================
# 工具函数
# =========================

def print_title(title: str):
    print("\n" + "=" * 50)
    print(title)
    print("=" * 50)


def print_response(response):
    print(f"Status Code: {response.status_code}")

    try:
        parsed = response.json()

        print(json.dumps(parsed, indent=2))

    except Exception:
        print(response.text)


# =========================
# 测试 hello
# =========================

def test_hello():
    print_title("Testing /hello")
    response = requests.get(
        f"{BASE_URL}/hello",
        headers=HEADERS
    )
    print_response(response)


# =========================
# 测试 summarize-cell
# =========================

def test_summarize():
    print_title("Testing /summarize-cell")
    payload = {
        "cell_source": "111"
    }
    response = requests.post(
        f"{BASE_URL}/summarize-cell",
        headers=HEADERS,
        json=payload
    )

    print_response(response)


# =========================
# 测试 suggest-next-steps
# =========================

def test_suggestions():
    print_title("Testing /suggest-next-steps")
    payload = {
        "cell_source": "222"
    }
    response = requests.post(
        f"{BASE_URL}/suggest-next-steps",
        headers=HEADERS,
        json=payload
    )

    print_response(response)


# =========================
# 主程序
# =========================

if __name__ == "__main__":
    print("Detected token:")
    print(TOKEN)
    test_hello()
    test_summarize()
    test_suggestions()
    print("\nAll tests completed.")
