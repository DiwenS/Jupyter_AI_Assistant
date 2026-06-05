import json

from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_summary_prompt, build_suggestions_prompt


# def suggest_next_cell(cellIndex):
#     return [f'FAKE suggestion1 for cell {cellIndex}', 'FAKE suggestion2', 'FAKE suggestion3']

def suggest_next_cell(selected_cell_source, previous_context, next_context):
    print("============= AI suggesting =============")
    print("== suggestion input ==")
    print("⬇️ Selected Cell Source ⬇️")
    print(selected_cell_source)
    print("⬇️ Previous Context ⬇️")
    print(previous_context)
    print("⬇️ Next Context ⬇️")
    print(next_context)
    print("=" * 45)

    USE_OLLAMA = True

    if USE_OLLAMA:
        message = build_suggestions_prompt(selected_cell_source, previous_context, next_context)
        response = generate(message)
    else:
        response = {
            "suggestions": [
                "moke response"
            ]
        }

    print("[LOG-sug] Raw AI response:")
    print(response)

    if not response:
        print("[ERROR] Empty response from AI model.")
        return ["No AI suggestions generated"]

    # if isinstance(response, str):
    #     response = json.loads(response)

    try:
        if isinstance(response, str):
            response = response.strip()

            # 删除markdown标记
            if response.startswith("```"):
                response = response.replace("```json", "")
                response = response.replace("```", "")
                response = response.strip()

            response = json.loads(response)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Failed to parse AI response as JSON: {e}")
        return ["No AI suggestions generated"]


    if not isinstance(response, dict):
        print("[ERROR] Response is not a dictionary")
        return ["Invalid AI response format"]

    suggestions = response.get("suggestions")

    if not isinstance(suggestions, list):
        print("[ERROR] suggestions field is not a list")
        return ["Invalid suggestions format"]

    # return response.get("suggestions", ["No AI suggestions generated"])
    return suggestions