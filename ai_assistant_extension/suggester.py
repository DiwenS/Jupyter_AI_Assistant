import json

from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_summary_prompt, build_suggestions_prompt


# def suggest_next_cell(cellIndex):
#     return [f'FAKE suggestion1 for cell {cellIndex}', 'FAKE suggestion2', 'FAKE suggestion3']

# FIXME: 模型有时候返回空内容 - ERROR

def suggest_next_cell(selected_cell_source, context):
    print("============= AI suggesting =============")
    print("== suggestion input ==")
    print("⬇️ Selected Cell Source ⬇️")
    print(selected_cell_source)
    print("⬇️ Context ⬇️")
    print(context)

    message = build_suggestions_prompt(selected_cell_source, context)
    response = generate(message)
    print("[LOG] Raw AI response:")
    print(response)

    if isinstance(response, str):
        response = json.loads(response)

    return response.get("suggestions", ["No AI suggestions generated"])