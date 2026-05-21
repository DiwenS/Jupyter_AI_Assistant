from typing import Dict, List, Optional
import json


def _format_context(context: Dict) -> str:
    """
    将笔记本上下文词典转换为可读文本。
    """
    return json.dumps(context, indent=2, ensure_ascii=False)


# ==========================================================
# Summary Prompt
# ==========================================================

def build_summary_prompt(
        selected_cell: str,
        context: Dict,
        notebook_path: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    Build prompt for notebook cell summarization.
    """

    context_text = _format_context(context)

    notebook_info = (
        f"Notebook path: {notebook_path}"
        if notebook_path
        else "Notebook path: unknown"
    )

    system_prompt = """
You are an expert Jupyter notebook assistant.

Your task is to summarize the selected notebook cell.

Requirements:
- Be concise and accurate.
- Focus on what the code or markdown is doing.
- Mention important libraries, variables, or analysis goals.
- Return ONLY valid JSON.
- Do not include markdown.
- Do not include explanations outside JSON.

Expected JSON format:
{
  "summary": "..."
}
"""

    user_prompt = f"""
{notebook_info}

NOTEBOOK CONTEXT:
{context_text}

SELECTED CELL:
{selected_cell}
"""

    return [
        {
            "role": "system",
            "content": system_prompt.strip(),
        },
        {
            "role": "user",
            "content": user_prompt.strip(),
        },
    ]


# ==========================================================
# Suggestions Prompt
# ==========================================================

def build_suggestions_prompt(
        selected_cell: str,
        context: Dict,
) -> List[Dict[str, str]]:
    """
    Build prompt for next-cell suggestions.
    """

    context_text = _format_context(context)

    system_prompt = """
You are an expert data science and Jupyter notebook assistant.

Your task is to suggest the next reasonable notebook steps.

Suggestions should:
- Follow the current notebook workflow.
- Be technically meaningful.
- Avoid repeating completed steps.
- Prioritize useful analysis or debugging actions.

Return ONLY valid JSON.

Expected JSON format:
{
  "suggestions": [
    "...",
    "...",
    "..."
  ]
}
"""

    user_prompt = f"""
NOTEBOOK CONTEXT:
{context_text}

CURRENT SELECTED CELL:
{selected_cell}
"""

    return [
        {
            "role": "system",
            "content": system_prompt.strip(),
        },
        {
            "role": "user",
            "content": user_prompt.strip(),
        },
    ]
