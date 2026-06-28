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
        previous_summaries: List[str] = None,
        future_summaries: List[str] = None,
        generated_sug_titles: List[str] = None,
) -> List[Dict[str, str]]:
    """
    Build prompt for next-cell suggestions.
    """

    # previous_context_text = _format_context(previous_context)
    # next_context_text = _format_context(next_context)
    # print("============= Building Suggestions Prompt =============")
    # print(previous_context_text)
    # print("=" * 45)
    # print(next_context_text)
    # print("=" * 45)

    system_prompt = """
You are an expert data science and Jupyter notebook assistant.

Your task is to suggest the next reasonable actions
or notebook steps for the CURRENT SELECTED CELL.

You are given:
- Previous cell summaries (what has been done)
- Future cell summaries (what comes next in notebook structure)
- The current selected cell
- previously already generated suggestions

For each suggestion generate:
- suggestion:
  A concise description of the next action or notebook step.
- cellType:
  The most appropriate notebook cell type.
  Usually "code" or "markdown".
  
Rules:
- Generate 3-5 suggestions.
- Use "code" for executable analysis steps.
- Use "markdown" for documentation or explanation steps.
- The "suggestion" field should briefly describe what to do next.
- Do not include content generation yet.
- Do not include explanations outside JSON.
- Do NOT generate suggestions that are semantically equivalent to any previously generated suggestion.
- If a similar suggestion already exists, generate a different reasonable next step instead.

Do not think step by step.
Provide only the final JSON output.

Return ONLY valid JSON.

Expected format:
{
  "suggestions": [
    {
      "suggestion": "Visualize the data distribution",
      "cellType": "code"
    },
    {
      "suggestion": "Summarize the findings",
      "cellType": "markdown"
    }
  ]
}
"""

    user_prompt = f"""
PREVIOUS CONTEXT:
{previous_summaries}

CURRENT SELECTED CELL:
{selected_cell}

NEXT CONTEXT:
{future_summaries}

PREVIOUSLY GENERATED SUGGESTIONS:
{generated_sug_titles}
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
        selected_cell_source: str = "",
        selected_cell_type: str = "code",
        suggestion_source: str = "llm",
        previous_context: Optional[Dict] = None,
        next_context: Optional[Dict] = None,
) -> List[Dict[str, str]]:
    """
    Build prompt for notebook cell content generation.

    This prompt supports both AI-generated suggestions and user-written
    custom suggestions.
    """

    system_prompt = """
You are an expert Python data science and Jupyter notebook assistant.

Your task is to generate the content of a new Jupyter notebook cell
based on a selected next-step suggestion.

The suggestion may come from:
- the AI assistant, or
- the user directly.

Requirements:
- Generate executable Python code unless the requested cell type is markdown.
- If the request is ambiguous, infer a reasonable next step from the selected cell.
- Follow the user's suggestion as the main instruction.
- Keep the generated cell concise and useful.
- Do not include markdown code fences.
- Do not include explanations outside the generated cell content.
- Return ONLY the cell content.

For markdown cells:
- Produce well-structured, notebook-friendly Markdown.
- Use clear heading hierarchy (e.g., ## for section titles, ### for subsections) and avoid skipping heading levels.
- Separate paragraphs, lists, and code examples with blank lines for readability.
- Use bullet or numbered lists where appropriate instead of long paragraphs.
- Use Markdown tables only when they improve clarity.
- Wrap inline code, variable names, function names, and file names in backticks.
- Use fenced code blocks with an appropriate language identifier for code examples.
- Use LaTeX syntax (`$...$` or `$$...$$`) for mathematical expressions when appropriate.
- Ensure the Markdown is syntactically valid and renders cleanly in Jupyter Notebook.
- Write Markdown as educational notebook content rather than as an article. Prefer concise explanations, clear transitions, and direct relevance to the surrounding notebook context.
"""

    user_prompt = f"""
Suggestion source:
{suggestion_source}

Requested cell type:
{selected_cell_type}

Selected cell source:
{selected_cell_source}

Selected suggestion title:
{selected_sug_title}

Selected suggestion description:
{selected_sug_desc}

previous notebook context:
{_format_context(previous_context) if previous_context else "None"}

next notebook context:
{_format_context(next_context) if next_context else "None"}

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

def build_error_fix_prompt(
        cell_source: str,
        error_message: str,
        traceback: str = "",
        previous_context: Optional[List[Dict]] = None,
        next_context: Optional[List[Dict]] = None,
) -> List[Dict[str, str]]:
    """
    Build prompt for fixing a failed Jupyter code cell.
    """

    previous_context = previous_context or []
    next_context = next_context or []

    previous_context_text = _format_context(previous_context)
    next_context_text = _format_context(next_context)

    system_prompt = """
You are an expert Python and Jupyter notebook assistant.

Your task is to fix a code cell that produced an error.

Requirements:
- Return ONLY the corrected Python code for the cell.
- Do not include markdown code fences.
- Do not include explanations outside the code.
- Preserve the user's original intention as much as possible.
- Make the smallest reasonable fix.
- If imports are missing, add only the necessary imports.
- If the error is NameError or an undefined variable error, inspect the previous notebook context and reuse an existing variable if it clearly matches the user's intention.
- Example: if the failed code uses df.head() but previous context defines sales = pd.read_csv(...), return sales.head().
- Do not invent new dataframes, fake file paths, or unrelated variables.
- Do not return an empty response. If a reasonable fix is possible, return corrected code.
"""

    user_prompt = f"""
The following Jupyter notebook code cell failed.

FAILED CELL SOURCE:
{cell_source}

ERROR MESSAGE:
{error_message}

TRACEBACK:
{traceback}

PREVIOUS NOTEBOOK CONTEXT:
{previous_context_text}

NEXT NOTEBOOK CONTEXT:
{next_context_text}

Please return the corrected code cell content only.
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