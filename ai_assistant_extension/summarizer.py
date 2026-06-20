import json

from ai_assistant_extension.prompts import build_summary_prompt
from ai_assistant_extension.llm_client import generate

# FIXME: 一旦开始summary，必须等所有summary完成后才能停止kernel

# def summarize_cell(cell_index):
#     return f"This is a FAKE summary of cell {cell_index}"

def summarize_cell(selected_cell_source):
    print("============= AI summarizing =============")
    message = build_summary_prompt(selected_cell_source, context = {})
    response = generate(message)
    print("[LOG-sum] Raw AI response:")
    print(response)

    # 视情况添加response有效性判断，具体代码见suggesster.py

    if not response:
        print("[ERROR] Empty response from AI model.")
        return {"title": "", "summary": "No AI summary generated"}

    if isinstance(response, str):
        try:
            response = json.loads(response)
        except (json.JSONDecodeError, TypeError):
            print("[ERROR] Failed to parse AI response as JSON.")
            return {"title": "", "summary": "No AI summary generated"}

    if not isinstance(response, dict):
        print("[ERROR] Unexpected AI response type:", type(response))
        return {"title": "", "summary": "No AI summary generated"}

    # 始终返回 {title, summary} 两个字符串字段，避免上游拿到 dict/list 当字符串用。
    return {
        "title": str(response.get("title", "") or ""),
        "summary": str(response.get("summary", "No AI summary generated") or "No AI summary generated"),
    }