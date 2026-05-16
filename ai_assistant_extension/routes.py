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


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    hello_route_pattern = url_path_join(base_url, "ai-assistant-extension", "hello")
    summarize_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "summarize-cell"
    )
    suggest_route_pattern = url_path_join(
        base_url, "ai-assistant-extension", "suggest-next-steps"
    )

    handlers = [
        (hello_route_pattern, HelloRouteHandler),
        (summarize_route_pattern, SummarizeCellHandler),
        (suggest_route_pattern, SuggestNextStepsHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
