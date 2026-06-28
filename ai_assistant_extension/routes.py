import json

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

from .sug_content import next_cell_content
from .summarizer import summarize_cell
from .suggester import suggest_next_cell
from .error_fixer import fix_code_error
from .llm_client import (
    get_llm_config,
    update_llm_config,
    test_llm_connection,
    classify_llm_error,
)

from .data_preprocessing import (
    _format_tree_outline,
    collect_future_summaries_by_index,
    collect_previous_summaries_by_index,
    collect_tree_warnings,
)


class HelloRouteHandler(APIHandler):
    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": (
                "Hello, world!"
                " This is the '/ai-assistant-extension/hello' endpoint."
                " Try visiting me in your browser!"
            ),
        }))

class HealthHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "status": "ok",
            "message": "AI backend is running",
        }))

""""
class SummarizeCellHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body()
        cell_source = data.get("cell_source", "")   # 如果前端没有传递 cell_source，默认为空字符串
        summary = summarize_cell(cell_source)
        self.finish(json.dumps({
            "status": "success",
            "summary": summary,
        }))

    def _finish_error(self, status_code, message):
        self.set_status(status_code)
        self.finish(json.dumps({
            "status": "error",
            "message": message,
        }))
"""
def _finish_llm_error(handler, status_code, message, error=None):
    """
    Send a frontend-friendly LLM error response.

    Frontend can use:
    - message: user-facing popup text
    - error.code: stable machine-readable error code
    - error.type: rough category
    - error.retriable: whether retry may help
    """
    payload = {
        "status": "error",
        "message": message,
    }

    if error is not None:
        payload["error"] = error

    handler.set_status(status_code)
    handler.finish(json.dumps(payload))

class LLMConfigHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "status": "success",
            "config": get_llm_config(),
            "availableProviders": [
                "ollama",
                "openai-compatible",
                "anthropic"
            ],
            "message": "Current LLM configuration."
        }))

    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body() or {}

        try:
            updated_config = update_llm_config(data)
        except Exception as e:
            self.set_status(400)
            self.finish(json.dumps({
                "status": "error",
                "message": f"Invalid LLM configuration: {str(e)}"
            }))
            return

        self.finish(json.dumps({
            "status": "success",
            "config": updated_config,
            "availableProviders": [
                "ollama",
                "openai-compatible",
                "anthropic"
            ],
            "message": "LLM configuration updated."
        }))

class LLMTestHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        """
        Test the current LLM configuration.

        Frontend can call this after saving model settings to decide whether
        to show a success message or an error dialog.
        """
        try:
            result = test_llm_connection()
        except Exception as e:
            current_config = get_llm_config()
            error_info = classify_llm_error(e, current_config)

            _finish_llm_error(
                self,
                400,
                f"LLM configuration test failed: {str(e)}",
                error_info,
            )
            return

        self.finish(json.dumps({
            "status": "success",
            "message": "LLM connection test succeeded.",
            "provider": result.get("provider", ""),
            "model": result.get("model", ""),
            "responsePreview": result.get("responsePreview", ""),
        }))

# 生成summary
class SummarizeCellHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body() or {}

        cell_id = data.get("cellId", "")
        cell_index = data.get("cellIndex", None)
        cell_type = data.get("cellType", "")

        # Preferred frontend field.
        cell_source = data.get("source", "")

        # Backward compatibility with the earlier backend prototype.
        if not cell_source:
            cell_source = data.get("cell_source", "")

        try:
            summary = summarize_cell(cell_source)
        except Exception as e:
            error_info = classify_llm_error(e, get_llm_config())
            _finish_llm_error(
                self,
                500,
                f"Failed to summarize cell: {str(e)}",
                error_info,
            )
            return

        self.finish(json.dumps({
            "status": "success",
            "cellId": cell_id,
            "cellIndex": cell_index,
            "cellType": cell_type,
            "summary": summary,
            "details": "",
            "metadata": {
                "source": "llm"
            }
        }))

"""
class SuggestNextStepsHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body()
        cell_source = data.get("cell_source", "")
        suggestions = suggest_next_cell(cell_source)
        self.finish(json.dumps({
            "status": "success",
            "suggestions": suggestions,
        }))

    def _finish_error(self, status_code, message):
        self.set_status(status_code)
        self.finish(json.dumps({
            "status": "error",
            "message": message,
        }))
"""

# 给出suggestions(按钮)
class SuggestNextStepsHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body() or {}
        print("[INFO] Frontend data =====")
        print(data)
        print("=========== ✅ ===========")

        selected_cell = data.get("selectedCell", {})
        context = data.get("context", {})
        previous_cells = context.get("previousCells", [])
        next_cells = context.get("nextCells", [])

        previous_sources = [cell.get("source", "") for cell in previous_cells]
        next_sources = [cell.get("source", "") for cell in next_cells]
        all_sources = previous_sources + next_sources

        # Preferred frontend structure.
        cell_source = selected_cell.get("source", "")

        # Backward compatibility with the earlier backend prototype.
        if not cell_source:
            cell_source = data.get("cell_source", "")

        # 保存已经生成过的suggestions，避免重复生成
        generated_sug_titles = [
            data["title"]
            for data in data["context"]["currentCellSuggestions"]
            if data["generated"]["status"] == "yes"
        ]

        print("[INFO] generated suggestions titles:")
        print(generated_sug_titles)
        print("======== ✅ ========")

        current_cell_index = selected_cell.get("cellIndex", "")

        previous_summaries = collect_previous_summaries_by_index(context["tree"], current_cell_index)
        print("[INFO] previous summaries:")
        print(previous_summaries)
        print("======== ✅ ========")
        """
        [INFO] previous summaries:
        ['This cell reads a CSV file into a pandas DataFrame using the pd.read_csv function.']
        """

        future_summaries = collect_future_summaries_by_index(context["tree"], current_cell_index)
        print("[INFO] future summaries:")
        print(future_summaries)
        print("======== ✅ ========")
        """
        [INFO] future summaries:
        ['Documents the process of loading a CSV dataset into a pandas DataFrame and verifying its contents.']
        """

        notbook_outline = _format_tree_outline(context["tree"])
        warnings = collect_tree_warnings(context["tree"])
        print("[INFO] Notebook outline:")
        print(notbook_outline)
        if warnings:
            print("[WARN] Notebook preprocessing warnings:")
            print(warnings)
        print("======== ✅ ========")
        """
        [INFO] Notebook outline:
        Notebook Outline
        - (Untitled) [code]
        - Load CSV Dataset [code]
            Summary: This cell reads a CSV file into a pandas DataFrame using the pd.read_csv function.
            - Data Verification Steps [markdown]
            Summary: Documents the process of verifying a pandas DataFrame, including shape, info, missing values, and summary statistics.
        - Dataset Loading and Verification [markdown]
            Summary: Documents the process of loading a CSV dataset into a pandas DataFrame and verifying its contents.
        - (Untitled) [markdown]
        """

        try:
            raw_suggestions = suggest_next_cell(
                cell_source,
                previous_summaries,
                future_summaries,
                generated_sug_titles,
            )
        except Exception as e:
            error_info = classify_llm_error(e, get_llm_config())
            _finish_llm_error(
                self,
                500,
                f"Failed to generate next-step suggestions: {str(e)}",
                error_info,
            )
            return

        suggestions = []
        for index, suggestion in enumerate(raw_suggestions):
            if isinstance(suggestion, dict):
                title = suggestion.get("suggestion", "")
                cell_type = suggestion.get("cellType", "code")
            else:
                title = str(suggestion)
                cell_type = "markdown"

            suggestions.append({
                "id": f"suggestion-{index + 1}",
                "title": title,
                "description": cell_type,
                "cellType": cell_type,
                "content": "# TODO: generate cell content here",
                "metadata": {
                    "source": "llm"
                }
            })

        self.finish(json.dumps({
            "status": "success",
            "suggestions": suggestions,
            "warnings": warnings,
            "metadata": {
                "source": "llm",
                "contextReceived": bool(context)
            }
        }))

# 根据suggestion生成cell content
# 返回更新后的suggestion,主要是该suggestion的content
# 支持用户自定义suggestion
class SelectSuggestionHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body() or {}
        print("============= Received select-suggestion request =============")
        print(data)

        selected_cell = data.get("selectedCell", {}) or {}
        selected_suggestion = data.get("selectedSuggestion", {}) or {}

        if not selected_suggestion:
            self.set_status(400)
            self.finish(json.dumps({
                "status": "error",
                "message": "Missing selectedSuggestion in request."
            }))
            return

        selected_cell_source = selected_cell.get("source", "")
        selected_cell_type = selected_cell.get("cellType", "code")

        selected_sug_title = selected_suggestion.get("title", "")
        selected_sug_desc = selected_suggestion.get("description", "")

        metadata = selected_suggestion.get("metadata", {}) or {}
        suggestion_source = metadata.get("source", "llm")

        # Fallback: if frontend only sends one text field, still use it.
        if not selected_sug_title:
            selected_sug_title = selected_suggestion.get("text", "")

        if not selected_sug_desc:
            selected_sug_desc = selected_sug_title

        if not selected_sug_title and not selected_sug_desc:
            self.set_status(400)
            self.finish(json.dumps({
                "status": "error",
                "message": "Selected suggestion must contain title or description."
            }))
            return

        previous_cells = (data.get("context") or {}).get("previousCells", [])
        next_cells = (data.get("context") or {}).get("nextCells", [])

        # print("⬇️ Selected cell previous context1 ⬇️")
        # print(previous_cells)
        # print("⬇️ Selected cell next context1 ⬇️")
        # print(next_cells)

        print("[Selected cell]")
        print(selected_cell)
        print("[Selected suggestion]")
        print(selected_suggestion)

        try:
            generated_content = next_cell_content(
                selected_sug_title=selected_sug_title,
                selected_sug_desc=selected_sug_desc,
                selected_cell_source=selected_cell_source,
                selected_cell_type=selected_cell_type,
                suggestion_source=suggestion_source,
                previous_context=previous_cells,
                next_context=next_cells,
            )
        except Exception as e:
            error_info = classify_llm_error(e, get_llm_config())
            _finish_llm_error(
                self,
                500,
                f"Failed to generate content for selected suggestion: {str(e)}",
                error_info,
            )
            return

        suggestion = {
            **selected_suggestion,
            "title": selected_sug_title,
            "description": selected_sug_desc,
            "cellType": selected_suggestion.get("cellType", "code"),
            "content": generated_content,
            "metadata": {
                **metadata,
                "source": suggestion_source,
                "contentSource": "llm"
            }
        }

        self.finish(json.dumps({
            "status": "success",
            "suggestion": suggestion,
            "message": "Generated content for selected suggestion.",
            "metadata": {
                "source": "llm",
                "suggestionSource": suggestion_source
            }
        }))

# 根据 code cell 的 error message 修正代码
class FixCodeErrorHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body() or {}
        print("============= Received fix-code-error request =============")
        print(data)

        selected_cell = data.get("selectedCell", {}) or {}
        context = data.get("context", {}) or {}

        cell_source = selected_cell.get("source", "")
        cell_id = selected_cell.get("cellId", "")
        cell_index = selected_cell.get("cellIndex", None)
        cell_type = selected_cell.get("cellType", "code")

        # Support both structured error object and simple fields.
        error = data.get("error", {}) or {}
        error_name = error.get("ename", "") or error.get("name", "")
        error_value = error.get("evalue", "") or error.get("message", "")
        traceback = error.get("traceback", "") or data.get("traceback", "")

        # Fallback if frontend sends a direct errorMessage field.
        error_message = data.get("errorMessage", "")
        if not error_message:
            error_message = "\n".join(
                part for part in [error_name, error_value] if part
            )

        if isinstance(traceback, list):
            traceback = "\n".join(str(line) for line in traceback)

        previous_cells = context.get("previousCells", [])
        next_cells = context.get("nextCells", [])

        if not cell_source:
            self.set_status(400)
            self.finish(json.dumps({
                "status": "error",
                "message": "Missing selectedCell.source in request."
            }))
            return

        if not error_message and not traceback:
            self.set_status(400)
            self.finish(json.dumps({
                "status": "error",
                "message": "Missing error message or traceback in request."
            }))
            return

        try:
            fixed_code = fix_code_error(
                cell_source=cell_source,
                error_message=error_message,
                traceback=traceback,
                previous_context=previous_cells,
                next_context=next_cells,
            )
        except Exception as e:
            error_info = classify_llm_error(e, get_llm_config())
            _finish_llm_error(
                self,
                500,
                f"Failed to fix code error: {str(e)}",
                error_info,
            )
            return

        self.finish(json.dumps({
            "status": "success",
            "cellId": cell_id,
            "cellIndex": cell_index,
            "cellType": cell_type,
            "fixedSource": fixed_code,
            "message": "Generated fixed code for failed cell.",
            "metadata": {
                "source": "llm",
                "errorName": error_name,
                "hasTraceback": bool(traceback),
                "contextReceived": bool(context)
            }
        }))

def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    hello_route_pattern = url_path_join(base_url, "ai-assistant-extension", "hello")
    summarize_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "summarize-cell"
    )
    health_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "health"
    )
    llm_config_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "llm-config"
    )
    llm_test_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "llm-test"
    )
    suggest_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "suggest-next-steps"
    )
    select_suggestion_route_pattern = url_path_join(
    base_url, "ai-assistant-extension", "select-suggestion"
    )
    fix_code_error_route_pattern = url_path_join(
    base_url, "ai-assistant-extension", "fix-code-error"
    )


    handlers = [
        (hello_route_pattern, HelloRouteHandler),
        (health_route_pattern, HealthHandler),
        (llm_config_route_pattern, LLMConfigHandler),
        (llm_test_route_pattern, LLMTestHandler),
        (summarize_route_pattern, SummarizeCellHandler),
        (suggest_route_pattern, SuggestNextStepsHandler),
        (select_suggestion_route_pattern, SelectSuggestionHandler),
        (fix_code_error_route_pattern, FixCodeErrorHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)


