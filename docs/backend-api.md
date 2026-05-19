# 后端 API Contract

本文档记录当前 AI Notebook Assistant 后端接口的 request / response 格式，主要用于前端和后端之间对接。
目前所有后端接口都注册在以下基础路径下：
```text
/ai-assistant-extension
```

当前 MVP 阶段，后端的 summary 和 suggestion 逻辑仍然是 rule-based / placeholder 实现。后续即使内部改成 LLM 或 OpenAI 调用，前端使用的接口格式也应尽量保持稳定。


## 1. Health检查接口

### Endpoint
```http
GET /ai-assistant-extension/health
```

### 用途
用于检查后端 server extension 是否正常运行。

### Response
```json
{
  "status": "ok",
  "message": "AI backend is running"
}
```

## 2. Cell summary接口

### Endpoint
```http
POST /ai-assistant-extension/summarize-cell
```

### 用途
根据一个 notebook cell 的内容生成简短 summary。当前阶段返回的是 fake / rule-based summary，之后可以替换成 LLM 生成的 summary。

### 推荐 Request 格式
```json
{
  "cellId": "cell-0",
  "cellIndex": 0,
  "cellType": "code",
  "source": "import pandas as pd"
}
```

### Request 字段说明
| 字段        | 类型   | 是否必需 | 说明                                 |
| ----------- | ------ | -------: | ------------------------------------ |
| `cellId`    | string |       否 | 前端为 cell 分配的 ID                |
| `cellIndex` | number |       否 | cell 在 notebook 中的序号            |
| `cellType`  | string |       否 | cell 类型，例如 `code` 或 `markdown` |
| `source`    | string |       是 | cell 的源代码或文本内容              |

### 兼容旧版 Request 格式
为了兼容之前的 rule-based backend prototype，目前后端也支持旧格式：

```json
{
  "cell_source": "import pandas as pd"
}
```

### Response
```json
{
  "status": "success",
  "cellId": "cell-0",
  "cellIndex": 0,
  "cellType": "code",
  "summary": "This is a FAKE summary of cell import pandas as pd",
  "details": "",
  "metadata": {
    "source": "rule-based"
  }
}
```

### Response 字段说明
| 字段              | 类型           | 说明                              |
| ----------------- | -------------- | --------------------------------- |
| `status`          | string         | 请求状态，目前成功时为 `success`  |
| `cellId`          | string         | 从 request 中传回的 cell ID       |
| `cellIndex`       | number 或 null | 从 request 中传回的 cell 序号     |
| `cellType`        | string         | 从 request 中传回的 cell 类型     |
| `summary`         | string         | 后端生成的 cell summary           |
| `details`         | string         | 预留字段，目前为空字符串          |
| `metadata`        | object         | 额外信息                          |
| `metadata.source` | string         | 当前生成来源，目前为 `rule-based` |


## 3. Next step suggestions接口

### Endpoint
```http
POST /ai-assistant-extension/suggest-next-steps
```

### 用途
根据当前选中的 cell 和可选的 notebook 上下文，生成下一步分析建议。当前阶段返回的是 fake / rule-based suggestions，之后可以替换成 LLM 生成的 suggestions。

### 推荐 Request 格式
```json
{
  "selectedCell": {
    "cellId": "cell-0",
    "cellIndex": 0,
    "cellType": "code",
    "source": "import pandas as pd",
    "summary": "Import libraries"
  },
  "context": {
    "previousCells": [],
    "nextCells": [],
    "tree": []
  }
}
```

### Request 字段说明
| 字段                     | 类型   | 是否必需 | 说明                                      |
| ------------------------ | ------ | -------: | ----------------------------------------- |
| `selectedCell`           | object |       是 | 当前选中的 cell                           |
| `selectedCell.cellId`    | string |       否 | 当前 cell 的 ID                           |
| `selectedCell.cellIndex` | number |       否 | 当前 cell 在 notebook 中的序号            |
| `selectedCell.cellType`  | string |       否 | 当前 cell 类型，例如 `code` 或 `markdown` |
| `selectedCell.source`    | string |       是 | 当前 cell 的源代码或文本内容              |
| `selectedCell.summary`   | string |       否 | 当前 cell 已有的 summary                  |
| `context`                | object |       否 | notebook 上下文信息                       |
| `context.previousCells`  | array  |       否 | 当前 cell 前面的 cells 或 summaries       |
| `context.nextCells`      | array  |       否 | 当前 cell 后面的 cells 或 summaries       |
| `context.tree`           | array  |       否 | 当前 notebook tree 结构                   |

### 兼容旧版 Request 格式
为了兼容之前的 rule-based backend prototype，目前后端也支持旧格式：
```json
{
  "cell_source": "import pandas as pd"
}
```

### Response
```json
{
  "status": "success",
  "suggestions": [
    {
      "id": "suggestion-1",
      "title": "FAKE suggestion1 for cell import pandas as pd",
      "description": "FAKE suggestion1 for cell import pandas as pd",
      "cellType": "code",
      "content": "# TODO: generate cell content here",
      "metadata": {
        "source": "rule-based"
      }
    }
  ],
  "metadata": {
    "source": "rule-based",
    "contextReceived": true
  }
}
```

### Response 字段说明
| 字段                        | 类型    | 说明                                            |
| --------------------------- | ------- | ----------------------------------------------- |
| `status`                    | string  | 请求状态，目前成功时为 `success`                |
| `suggestions`               | array   | 下一步建议列表                                  |
| `suggestions[].id`          | string  | suggestion 的 ID                                |
| `suggestions[].title`       | string  | 前端展示用的简短标题                            |
| `suggestions[].description` | string  | 对 suggestion 的详细说明                        |
| `suggestions[].cellType`    | string  | 建议生成的 cell 类型，例如 `code` 或 `markdown` |
| `suggestions[].content`     | string  | 建议插入到新 cell 中的内容                      |
| `suggestions[].metadata`    | object  | 当前 suggestion 的额外信息                      |
| `metadata.source`           | string  | 当前生成来源，目前为 `rule-based`               |
| `metadata.contextReceived`  | boolean | 后端是否收到了 context                          |

---
## select-suggestion 接口

### Endpoint
```http
POST /ai-assistant-extension/select-suggestion
```
### 用途
接收用户选中的 suggestion，并返回带有生成内容的 updated suggestion。当前阶段 content 是 placeholder。

### 推荐Request格式
```json
{
  "selectedCell": {
    "cellId": "cell-0",
    "cellIndex": 0,
    "cellType": "code",
    "source": "import pandas as pd",
    "summary": "Import libraries"
  },
  "selectedSuggestion": {
    "id": "suggestion-1",
    "title": "Plot distribution",
    "description": "Create a histogram.",
    "cellType": "code",
    "content": "# TODO: generate cell content here",
    "metadata": {
      "source": "rule-based"
    }
  }
}
```

### Response
```json
{
  "status": "success",
  "suggestion": {
    "id": "suggestion-1",
    "title": "FAKE suggestion1 for cell import pandas as pd",
    "description": "FAKE suggestion1 for cell import pandas as pd",
    "cellType": "code",
    "content": "fake generated code cell",
    "metadata": {
      "source": "placeholder"
    }
  },
  "message": "Generated content for selected suggestion.",
  "metadata": {
    "source": "placeholder"
  }
}
```


## 4. 前端调用说明
前端建议使用 `src/request.ts` 中已有的 `requestAPI()` 方法调用后端接口，而不是直接使用普通 `fetch()`。原因是 JupyterLab 的 request helper 可以处理 base URL、server settings 和认证相关问题。

### 调用 health endpoint
```ts
requestAPI<any>('health')
```

### 调用 summarize-cell endpoint
```ts
requestAPI<any>('summarize-cell', {
  method: 'POST',
  body: JSON.stringify({
    cellId: 'cell-0',
    cellIndex: 0,
    cellType: 'code',
    source: 'import pandas as pd'
  })
})
```

### 调用 suggest-next-steps endpoint
```ts
requestAPI<any>('suggest-next-steps', {
  method: 'POST',
  body: JSON.stringify({
    selectedCell: {
      cellId: 'cell-0',
      cellIndex: 0,
      cellType: 'code',
      source: 'import pandas as pd',
      summary: 'Import libraries'
    },
    context: {
      previousCells: [],
      nextCells: [],
      tree: []
    }
  })
})
```

---

## 5. 当前限制
- 当前 summary 和 suggestion 仍然是 placeholder / rule-based 逻辑。
- `suggestions[].content` 目前还是占位内容，后续需要由 rule-based logic 或 LLM 生成。
- 当前接口主要保证前后端可以稳定对接，后续可以继续完善错误处理。
- 当前仍然保留旧版 `cell_source` request 格式，方便兼容已有测试代码。