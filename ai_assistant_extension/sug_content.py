from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_content_generation_prompt


def next_cell_content(
    selected_sug_title, 
    selected_sug_desc,
    selected_cell_source="",
    selected_cell_type="code",
    suggestion_source="llm",
):
    print("============= AI generating next cell content =============")
    print("== suggestion input ==")
    print("⬇️ Suggestion Source ⬇️")
    print(suggestion_source)
    print("⬇️ Selected Cell Type ⬇️")
    print(selected_cell_type)
    print("⬇️ Selected Cell Source ⬇️")
    print(selected_cell_source)
    print("⬇️ Selected Suggestion Title ⬇️")
    print(selected_sug_title)
    print("⬇️ Selected Suggestion Description ⬇️")
    print(selected_sug_desc)
    print("=" * 45)

    message = build_content_generation_prompt(
        selected_sug_title=selected_sug_title,
        selected_sug_desc=selected_sug_desc,
        selected_cell_source=selected_cell_source,
        selected_cell_type=selected_cell_type,
        suggestion_source=suggestion_source,
    )
    
    response = generate(message)

    print("[LOG-content] Raw AI response:")
    print(response)

    return response
