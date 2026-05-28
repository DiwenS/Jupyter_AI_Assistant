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

    if isinstance(response, str):
        response = json.loads(response)

    return response.get("suggestions", ["No AI suggestions generated"])