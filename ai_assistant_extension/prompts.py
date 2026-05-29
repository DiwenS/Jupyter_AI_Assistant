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

Your task is to summarize the selected notebook cell
and generate a short title for it.

Requirements:
- Be concise and accurate.
- Focus on what the code or markdown is doing.
- Mention important libraries, variables, or analysis goals.
- Generate a title with no more than 5 words.
- The title should briefly describe the main purpose of the cell.
- Return ONLY valid JSON.
- Do not include markdown.
- Do not include explanations outside JSON.

Do not think step by step. Provide only the final JSON output.

Expected JSON format:
{
  "title": "...",
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
        previous_context: Dict,
        next_context: Dict,
) -> List[Dict[str, str]]:
    """
    Build prompt for next-cell suggestions.
    """

    previous_context_text = _format_context(previous_context)
    next_context_text = _format_context(next_context)
    print("============= Building Suggestions Prompt =============")
    print(previous_context_text)
    print("=" * 45)
    print(next_context_text)
    print("=" * 45)

    system_prompt = """
You are an expert data science and Jupyter notebook assistant.

Your task is to suggest the next reasonable actions
or notebook steps for the CURRENT SELECTED CELL.

You are given:
- Previous notebook context:
  cells that appear before the selected cell.
- Next notebook context:
  cells that appear after the selected cell.

Use both contexts to understand:
- the notebook workflow,
- completed analysis steps,
- upcoming analysis intentions,
- and the role of the selected cell.

Suggestions should:
- Focus on what should reasonably happen next
  after the CURRENT SELECTED CELL.
- Be technically meaningful.
- Follow the notebook workflow.
- Avoid repeating already completed steps.
- Avoid suggesting steps already implemented
  in the next context unless refinement is useful.
- Prioritize useful analysis, debugging,
  visualization, or data-processing actions.
  
Do not think step by step. Provide only the final JSON output.
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
PREVIOUS CONTEXT:
{previous_context_text}

CURRENT SELECTED CELL:
{selected_cell}

NEXT CONTEXT:
{next_context_text}
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


def build_content_generation_prompt(
        selected_sug_title: str,
        selected_sug_desc: str,
) -> List[Dict[str, str]]:
    """
    Build prompt for notebook cell content generation.
    """

    system_prompt = """
You are an expert Python data science
and Jupyter notebook assistant.

Your task is to generate the content
of a new Jupyter notebook cell
based on the selected suggestion.

Requirements:
- Generate executable Python code.
- Focus on data science and notebook workflows.
- Write clean, concise, and readable code.
- Use notebook-style code formatting.
- Do not include markdown code fences.
- Do not include explanations outside code.
- Do not include natural language descriptions.
- Return ONLY the code content.
"""

    user_prompt = f"""
Selected Suggestion Title:
{selected_sug_title}

Selected Suggestion Description:
{selected_sug_desc}

Generate the corresponding Jupyter notebook cell content.

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
