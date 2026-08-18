# ai_assistant_extension

An AI-assisted JupyterLab extension for cell summarization, notebook tree visualization, context-aware next-step suggestions, and generated notebook cells.

This repository contains both parts of a JupyterLab frontend-and-server extension:

- `ai_assistant_extension`: the Python package for the Jupyter Server backend extension
- `ai-assistant-extension`: the NPM package for the JupyterLab frontend extension

## Features

- Summarize notebook cells and generate short titles/descriptions.
- Build an interactive tree view of notebook cells and generated child cells.
- Generate AI next-step suggestions for the current cell using notebook context.
- Generate new cell content from a selected suggestion.
- Configure LLM providers from the JupyterLab UI.
- Support local Ollama models and remote API-compatible providers.
- Recover gracefully from LLM errors without blocking the notebook UI.

## System Requirements

### Required

- Python `>=3.10`
- JupyterLab `>=4.0.0,<5`
- Jupyter Server `>=2.4.0,<3`
- Node.js, required for building the frontend extension
- `jlpm`, JupyterLab's pinned Yarn command
- `pip`

### Python Dependencies

The Python dependencies are declared in `pyproject.toml`:

- `jupyter_server>=2.4.0,<3`
- `requests>=2.31.0`

### Frontend Dependencies

The frontend dependencies are declared in `package.json`, including:

- `@jupyterlab/application`
- `@jupyterlab/coreutils`
- `@jupyterlab/notebook`
- `@jupyterlab/services`
- `@jupyterlab/settingregistry`
- `typescript`

### Optional Local LLM Runtime

For local AI generation, install and run Ollama separately. The default local configuration used by the extension is:

- Provider: `ollama`
- Base URL: `http://localhost:11434`
- Model: `qwen3:8b`

Example Ollama setup:

```bash
ollama pull qwen3:8b
ollama serve
```

[Recommended]: If you use `openai-compatible` or `anthropic` instead, configure the provider, base URL, model, and API key in the extension's LLM settings panel.

## Project Structure

```text
ai_assistant_extension/      Python backend server extension
src/                         TypeScript frontend JupyterLab extension
style/                       Frontend styles
schema/                      JupyterLab settings schema
jupyter-config/              Jupyter Server extension configuration
docs/                        Backend/API documentation
package.json                 Frontend package and build scripts
pyproject.toml               Python package and JupyterLab build metadata
```

Important backend files:

- `ai_assistant_extension/routes.py`: REST API route handlers.
- `ai_assistant_extension/summarizer.py`: cell summarization logic.
- `ai_assistant_extension/suggester.py`: AI next-step suggestion logic.
- `ai_assistant_extension/sug_content.py`: generated content for selected suggestions.
- `ai_assistant_extension/prompts.py`: prompt construction.
- `ai_assistant_extension/llm_client.py`: LLM provider configuration and API calls.
- `ai_assistant_extension/data_preprocessing.py`: notebook context preprocessing.

Important frontend files:

- `src/index.ts`: main JupyterLab plugin, panel UI, notebook tree, and cell interactions.
- `src/api.ts`: typed frontend API wrappers.
- `src/request.ts`: low-level Jupyter Server request helper.
- `src/llmErrors.ts`: frontend LLM error parsing.
- `src/errorDisplay.ts`: frontend error presentation helpers.

## Development Setup

Always activate the project environment before running Python, Jupyter, `pip`, or `jlpm` commands.

```bash
cd /path/to/Jupyter_AI_Assistant
python -m venv .venv
source .venv/bin/activate
```

Install the Python package in editable mode:

```bash
pip install -e .
```

Install frontend dependencies:

```bash
jlpm install
```

## Running the Project

### 1. Activate the Environment

```bash
cd /path/to/Jupyter_AI_Assistant
source .venv/bin/activate
```

### 2. Build the Frontend Extension

```bash
jlpm build
```

This compiles TypeScript into `lib/` and builds the JupyterLab extension assets into `ai_assistant_extension/labextension/`.

### 3. Register the Extension with JupyterLab

Run these commands once after setup, or again if JupyterLab does not detect the extension:

```bash
pip install -e .
jupyter labextension develop . --overwrite
jupyter server extension enable ai_assistant_extension
```

### 4. Start JupyterLab

```bash
jupyter lab
```

Open a notebook and use the AI Assistant panel in JupyterLab.

### 5. Configure the LLM Provider

In the AI Assistant panel:

1. Open the LLM settings section.
2. Select a provider, for example `OpenAI`.
3. Set the model, for example `gpt-4o-mini`.
4. Set the base URL, for example `https://api.openai.com/v1`.
5. Enter the API key if required by the provider.
6. Save the configuration.

For Ollama, no API key is required. For remote providers, enter the required API key.

## Recommended Development Workflow

Use two terminals while developing.

Terminal 1, watch frontend changes:

```bash
source .venv/bin/activate
jlpm watch
```

Terminal 2, run JupyterLab:

```bash
source .venv/bin/activate
jupyter lab
```

After editing TypeScript files in `src/`, refresh the browser. If you are not using `jlpm watch`, run:

```bash
jlpm build
```

After editing Python files in `ai_assistant_extension/`, restart the JupyterLab server.

## Validation Commands

Check Python syntax:

```bash
python -m py_compile ai_assistant_extension/routes.py
```

Check TypeScript:

```bash
npx tsc --noEmit
```

Build the extension:

```bash
jlpm build
```

Verify frontend extension installation:

```bash
jupyter labextension list
```

Verify backend server extension installation:

```bash
jupyter server extension list
```

## API Overview

The frontend communicates with the backend through the `ai-assistant-extension` API namespace.

Important endpoints:

- `GET /ai-assistant-extension/hello`
- `GET /ai-assistant-extension/health`
- `GET /ai-assistant-extension/llm-config`
- `POST /ai-assistant-extension/llm-config`
- `POST /ai-assistant-extension/llm-test`
- `POST /ai-assistant-extension/summarize-cell`
- `POST /ai-assistant-extension/suggest-next-steps`
- `POST /ai-assistant-extension/select-suggestion`
- `POST /ai-assistant-extension/fix-code-error`

## Troubleshooting

### Frontend Extension Is Not Visible

Check whether the frontend extension is installed and enabled:

```bash
jupyter labextension list
```

If it is missing, run:

```bash
jupyter labextension develop . --overwrite
jlpm build
```

Then restart JupyterLab and refresh the browser.

### Backend API Is Not Working

Check whether the server extension is enabled:

```bash
jupyter server extension list
```

If it is disabled, run:

```bash
jupyter server extension enable ai_assistant_extension
```

Then restart JupyterLab.

### Ollama Connection Fails

Make sure Ollama is running and the model is available:

```bash
ollama list
ollama serve
```

The default base URL is `http://localhost:11434`.

### Changes Do Not Appear in JupyterLab

- TypeScript changes require `jlpm build` or `jlpm watch`, followed by a browser refresh.
- Python backend changes require restarting the JupyterLab server.
- Extension registration problems may require rerunning:

```bash
pip install -e .
jupyter labextension develop . --overwrite
jupyter server extension enable ai_assistant_extension
```

## Uninstall

Disable and remove the development extension:

```bash
jupyter server extension disable ai_assistant_extension
pip uninstall ai_assistant_extension
```

In development mode, you may also need to remove the symlink created by `jupyter labextension develop . --overwrite`. Use `jupyter labextension list` to find the labextensions directory, then remove the `ai-assistant-extension` symlink.

## Packaging

Release and packaging instructions are documented in `RELEASE.md`.
