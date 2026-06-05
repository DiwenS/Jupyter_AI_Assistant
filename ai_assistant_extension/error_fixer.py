from ai_assistant_extension.llm_client import generate
from ai_assistant_extension.prompts import build_error_fix_prompt

def _simple_name_error_fallback(cell_source, error_message, previous_context):
    """
    Very small fallback for common notebook NameError cases.

    Example:
    failed cell: df.head()
    previous context: sales = pd.read_csv("sales.csv")
    error: name 'df' is not defined
    fixed: sales.head()
    """
    if "NameError" not in error_message and "not defined" not in error_message:
        return ""

    if "df" not in cell_source:
        return ""

    previous_context = previous_context or []

    for cell in previous_context:
        source = cell.get("source", "")
        for line in source.splitlines():
            stripped = line.strip()

            if "=" not in stripped:
                continue

            variable_name = stripped.split("=", 1)[0].strip()

            if variable_name and variable_name.isidentifier():
                return cell_source.replace("df", variable_name)

    return ""

def fix_code_error(
    cell_source,
    error_message,
    traceback="",
    previous_context=None,
    next_context=None,
):
    """
    Generate a corrected version of a failed code cell using the configured LLM.
    """
    print("============= AI fixing code error =============")
    print("⬇️ Failed Cell Source ⬇️")
    print(cell_source)
    print("⬇️ Error Message ⬇️")
    print(error_message)
    print("⬇️ Traceback ⬇️")
    print(traceback)
    print("=" * 45)

    messages = build_error_fix_prompt(
        cell_source=cell_source,
        error_message=error_message,
        traceback=traceback,
        previous_context=previous_context or [],
        next_context=next_context or [],
    )

    response = generate(messages)

    print("[LOG-fix-error] Raw AI response:")
    print(response)

    if not isinstance(response, str) or not response.strip():
        fallback = _simple_name_error_fallback(
            cell_source=cell_source,
            error_message=error_message,
            previous_context=previous_context,
        )

        if fallback:
            print("[LOG-fix-error] Using fallback fixed code:")
            print(fallback)
            return fallback

        raise ValueError("LLM returned empty fixed code.")

    return response.strip()