import json

from ai_assistant_extension.prompts import build_summary_prompt
from ai_assistant_extension.llm_client import generate

# FIXME: 一旦开始summary，必须等所有summary完成后才能停止kernel

# def summarize_cell(cell_index):
#     return f"This is a FAKE summary of cell {cell_index}"

# 解析/校验失败时的统一降级结构。保持 dict 形状（而不是裸字符串或 list），
# 这样前端 normalizeSummaryData() 仍然可以按 {title, summary} 的格式正常解析展示。
def _fallback_summary(message: str):
    return {
        "title": "",
        "summary": message,
    }

def summarize_cell(selected_cell_source):
    print("============= AI summarizing =============")
    message = build_summary_prompt(selected_cell_source, context={})
    response = generate(message)
    print("[LOG-sum] Raw AI response:")
    print(response)
    print("============= AI summarizing ✅ =============")

    if not response:
        print("[ERROR] Empty response from AI model.")
        return _fallback_summary("No AI summary generated")

    if isinstance(response, str):
        cleaned = response.strip()

        # 兼容模型仍然返回 markdown 代码块包裹的 JSON（与 suggester.py 的处理保持一致）。
        if cleaned.startswith("```"):
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()

        try:
            response = json.loads(cleaned)
        except json.JSONDecodeError as e:
            print(f"[ERROR] Failed to parse AI response as JSON: {e}")
            return _fallback_summary("No AI summary generated")

    if not isinstance(response, dict):
        print("[ERROR] Response is not a dictionary")
        return _fallback_summary("Invalid AI response format")

    # title/summary 字段缺失或类型错误时，仍返回结构完整的 dict，避免前端拿到 None。
    title = response.get("title", "")
    summary = response.get("summary", "")

    return {
        "title": title if isinstance(title, str) else "",
        "summary": summary if isinstance(summary, str) else "No AI summary generated",
    }