from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_summary_prompt


def suggest_next_cell(cellIndex):
    return [f'FAKE suggestion1 for cell {cellIndex}', 'FAKE suggestion2', 'FAKE suggestion3']

# message = build_summary_prompt()    # TODO: parameters
#
# response = generate(message)
# print(response)