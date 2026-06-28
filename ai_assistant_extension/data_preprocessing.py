from typing import Any, List, Dict


def _format_tree_outline(tree: list[dict[str, Any]]) -> str:
    """
    Convert the notebook tree into a concise outline suitable for LLM prompts.
    Adds a warning if any node is missing a title ("Untitled").
    """

    if not tree:
        return "None"

    lines = ["Notebook Outline"]

    has_untitled = False

    def dfs(node: dict[str, Any], depth: int = 0) -> None:
        nonlocal has_untitled
        indent = "  " * depth

        title = node.get("title")

        if not title:
            title = "(Untitled)"
            has_untitled = True

        summary = node.get("summary", "").strip()
        cell_type = node.get("cellType", "unknown")

        lines.append(f"{indent}- {title} [{cell_type}]")

        if summary:
            lines.append(f"{indent}  Summary: {summary}")

        for child in node.get("children", []):
            dfs(child, depth + 1)

    # Only traverse root nodes
    root_nodes = [
        node
        for node in tree
        if node.get("parentId") == "ROOT"
    ]

    for node in root_nodes:
        dfs(node)

    if has_untitled:
        lines.append("")
        lines.append(
            "⚠ WARNING: Some notebook cells are missing titles (Untitled). "
            "Please generate summaries/titles for better suggestion quality."
        )
    # TODO: 前端加入错误提示

    return "\n".join(lines)





def collect_future_summaries_by_index(tree: List[Dict[str, Any]], current_cell_index: int) -> List[str]:
    """
    Collect all summaries from nodes whose cellIndex > current_cell_index
    in the entire notebook tree.
    """

    results = []
    def dfs(node: Dict[str, Any]):
        # 1. check current node
        node_index = node.get("cellIndex", None)
        if node_index is not None and node_index > current_cell_index:
            if node.get("summary"):
                results.append(node["summary"])

        # 2. recurse into children
        for child in node.get("children", []):
            dfs(child)

    # root level traversal
    for root in tree:
        dfs(root)
    return results


def collect_previous_summaries_by_index(tree: List[Dict[str, Any]], current_cell_index: int) -> List[str]:
    """
    Collect all summaries from nodes whose cellIndex < current_cell_index
    in the entire notebook tree.
    """

    results = []
    def dfs(node: Dict[str, Any]):
        # 1. check current node
        node_index = node.get("cellIndex", None)
        if node_index is not None and node_index < current_cell_index:
            if node.get("summary"):
                results.append(node["summary"])

        # 2. recurse into children
        for child in node.get("children", []):
            dfs(child)

    # root level traversal
    for root in tree:
        dfs(root)
    return results