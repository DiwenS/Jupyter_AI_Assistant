from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_content_generation_prompt


def next_cell_content(selected_sug_title, selected_sug_desc):
    print("============= AI generating next cell content =============")
    print("== suggestion input ==")
    print("⬇️ Selected Suggestion Title ⬇️")
    print(selected_sug_title)
    print("⬇️ Selected Suggestion Description ⬇️")
    print(selected_sug_desc)
    print("=" * 45)

    message = build_content_generation_prompt(selected_sug_title, selected_sug_desc)
    response = generate(message)

    print("[LOG-content] Raw AI response:")
    print(response)

    return response
