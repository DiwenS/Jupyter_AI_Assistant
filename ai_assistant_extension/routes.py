import json

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

from .summarizer import summarize_cell
from .suggester import suggest_next_cell


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

        summary = summarize_cell(cell_source, context={})  # TODO: pass actual context

        self.finish(json.dumps({
            "status": "success",
            "cellId": cell_id,
            "cellIndex": cell_index,
            "cellType": cell_type,
            "summary": summary,
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

        # Preferred frontend structure.
        cell_source = selected_cell.get("source", "")

        # Backward compatibility with the earlier backend prototype.
        if not cell_source:
            cell_source = data.get("cell_source", "")

        raw_suggestions = suggest_next_cell(selected_cell.get("cellIndex"))

        suggestions = []
        for index, suggestion in enumerate(raw_suggestions):
            suggestions.append({
                "id": f"suggestion-{index + 1}",
                "title": str(suggestion),
                "description": str(suggestion),
                "cellType": "code",
                "content": "# TODO: generate cell content here",
                "metadata": {
                    "source": "rule-based"
                }
            })

        self.finish(json.dumps({
            "status": "success",
            "suggestions": suggestions,
            "metadata": {
                "source": "rule-based",
                "contextReceived": bool(context)
            }
        }))

# 根据suggestion生成cell content
# 返回更新后的suggestion,主要是该suggestion的content
# TODO: 目前更新的content是假的，后续需要接入真正的生成逻辑。或者后端新建一个函数
class SelectSuggestionHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        data = self.get_json_body() or {}

        selected_suggestion = data.get("selectedSuggestion", {})

        suggestion = {
            **selected_suggestion,
            "content": "fake generated code cell",
            "metadata": {
                "source": "placeholder"
            }
        }

        self.finish(json.dumps({
            "status": "success",
            "suggestion": suggestion,
            "message": "Generated content for selected suggestion.",
            "metadata": {
                "source": "placeholder"
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
    suggest_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "suggest-next-steps"
    )

    select_suggestion_route_pattern = url_path_join(
    base_url, "ai-assistant-extension", "select-suggestion"
)

    handlers = [
        (hello_route_pattern, HelloRouteHandler),
        (health_route_pattern, HealthHandler),
        (summarize_route_pattern, SummarizeCellHandler),
        (suggest_route_pattern, SuggestNextStepsHandler),
        (select_suggestion_route_pattern, SelectSuggestionHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)



