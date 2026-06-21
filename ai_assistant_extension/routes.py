import json

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

from .sug_content import next_cell_content
from .summarizer import summarize_cell
from .suggester import suggest_next_cell
from .error_fixer import fix_code_error
from .llm_client import get_llm_config, update_llm_config


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

        result = summarize_cell(cell_source)

        self.finish(json.dumps({
            "status": "success",
            "cellId": cell_id,
            "cellIndex": cell_index,
            "cellType": cell_type,
            "title": result.get("title", ""),
            "summary": result.get("summary", "No AI summary generated"),
            "details": "",
            "metadata": {
                "source": "rule-based"
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

        raw_suggestions = suggest_next_cell(cell_source, previous_cells, next_cells)

        if isinstance(raw_suggestions, dict):
            raw_suggestion_items = raw_suggestions.get("suggestions", [])
        elif isinstance(raw_suggestions, list):
            raw_suggestion_items = raw_suggestions
        else:
            raw_suggestion_items = []

        suggestions = []
        for index, suggestion in enumerate(raw_suggestion_items):
            if isinstance(suggestion, dict):
                suggestion_title = suggestion.get("suggestion", "")
                # suggestion_description = suggestion.get("description", suggestion_title)
                suggestion_cell_type = suggestion.get("cellType", "code")
            else:
                suggestion_title = str(suggestion)
                suggestion_description = suggestion_title
                suggestion_cell_type = "code"

            suggestions.append({
                "id": f"suggestion-{index + 1}",
                "title": suggestion_title,
                "description": suggestion_cell_type,
                "cellType": suggestion_cell_type,
                "content": "# TODO: generate cell content here",
                "metadata": {
                    "source": "llm"
                }
            })

        self.finish(json.dumps({
            "status": "success",
            "suggestions": suggestions,
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

        context = data.get("context") or {}
        if not isinstance(context, dict):
            context = {}
        previous_cells = context.get("previousCells", []) or []
        next_cells = context.get("nextCells", []) or []

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
            self.set_status(500)
            self.finish(json.dumps({
                "status": "error",
                "message": f"Failed to generate content for selected suggestion: {str(e)}"
            }))
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
            self.set_status(500)
            self.finish(json.dumps({
                "status": "error",
                "message": f"Failed to fix code error: {str(e)}"
            }))
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
        (summarize_route_pattern, SummarizeCellHandler),
        (suggest_route_pattern, SuggestNextStepsHandler),
        (select_suggestion_route_pattern, SelectSuggestionHandler),
        (fix_code_error_route_pattern, FixCodeErrorHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)


