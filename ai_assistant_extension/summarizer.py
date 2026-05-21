import json

from ai_assistant_extension.prompts import build_summary_prompt
from ai_assistant_extension.llm_client import generate

# FIXME: 一旦开始summary，必须等所有summary完成后才能停止kernel

# def summarize_cell(cell_index):
#     return f"This is a FAKE summary of cell {cell_index}"

def summarize_cell(selected_cell, context):
    print("============= 开始使用AI进行总结 =============")
    message = build_summary_prompt(selected_cell, context)
    response = generate(message)
    print(response)

    if isinstance(response, str):
        response = json.loads(response)

    return response.get("summary", "No summary generated")
