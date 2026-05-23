import json

from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_summary_prompt, build_suggestions_prompt


# def suggest_next_cell(cellIndex):
#     return [f'FAKE suggestion1 for cell {cellIndex}', 'FAKE suggestion2', 'FAKE suggestion3']

def suggest_next_cell(selected_cell_source, context):
    print("============= AI suggesting =============")
    message = build_suggestions_prompt(selected_cell_source, context)
    response = generate(message)
    print(response)

    if isinstance(response, str):
        response = json.loads(response)

    return response.get("suggestions", ["No AI suggestions generated"])