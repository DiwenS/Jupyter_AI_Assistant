import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import { ServerConnection } from '@jupyterlab/services';
import {
  ICellDescriptor,
  ISuggestion,
  ITreeNode,
  summarizeCell,
  suggestNextSteps
} from './api';

// Tree 中 node summary 的两种显示方式：固定显示或 hover 悬浮显示。
type SummaryDisplayMode = 'fixed' | 'hover';

class AIAssistantPanel extends Widget {
  private notebookTracker: INotebookTracker;
  //添加serversetting方便之后调用 summarizeCell(this.serverSettings, cell)
  private serverSettings: ServerConnection.ISettings;
  private summaries = new Map<string, string>();

  //AI next button 需要的 suggestions 数据结构，key 是 cellId，value 是对应的建议列表。
  private suggestions = new Map<string, ISuggestion[]>();
  private pendingSuggestionCellID = '';
  private statusMessage = '';



  // 保存用户当前选择的 summary 显示模式，重新渲染 tree 时保持一致。
  private summaryDisplayMode: SummaryDisplayMode = 'fixed';
  // 保存 tree 的缩放比例，1 表示 100%。
  private treeZoom = 1;


  constructor(notebookTracker: INotebookTracker,
    serverSettings: ServerConnection.ISettings
  ) {
    super();

    this.notebookTracker = notebookTracker;
    this.serverSettings = serverSettings;

    this.id = 'ai-assistant-extension-panel';
    this.title.label = 'AI Assistant';
    this.title.caption = 'AI Notebook Assistant';
    this.title.closable = true;
    this.title.iconClass = 'jp-SideBar-tabIcon jp-SettingsIcon';


    this.render();

    // 监听当前选择的 cell，保持侧边栏中的 active node 高亮同步，并滚动到对应 Tree node。
    this.notebookTracker.activeCellChanged.connect(() => {
      this.updateNotebookInfo();
      this.scrollActiveTreeNodeIntoView();
    });

    // 切换 notebook 时重新读取 notebook 信息和 tree。
    this.notebookTracker.currentChanged.connect(() => {
      this.updateNotebookInfo();
    });
  }

  private render(): void {
    this.node.innerHTML = `
      <div class="jp-ai-assistant-root">
        <h2>AI Notebook Assistant</h2>

        <button id="refresh-notebook-info">
          Refresh notebook info
        </button>

        <button id="refresh-cell-summaries">
          Refresh summaries
        </button>




        <hr />
        
        <h3>Current Notebook</h3>
        <div id="notebook-info">
          No notebook selected yet.
        </div>

        <div class="jp-ai-assistant-section-header">
          <h3>Notebook Tree</h3>
          <fieldset class="jp-ai-assistant-summary-mode">
            <label>
              <input
                id="summary-mode-fixed"
                type="radio"
                name="summary-display-mode"
                value="fixed"
                ${this.summaryDisplayMode === 'fixed' ? 'checked' : ''}
              />
              Fixed
            </label>
            <label>
              <input
                id="summary-mode-hover"
                type="radio"
                name="summary-display-mode"
                value="hover"
                ${this.summaryDisplayMode === 'hover' ? 'checked' : ''}
              />
              Hover
            </label>
          </fieldset>
        </div>
        <div class="jp-ai-assistant-tree-toolbar">
          <button id="tree-zoom-out" type="button" title="Zoom out tree">-</button>
          <span id="tree-zoom-value">${Math.round(this.treeZoom * 100)}%</span>
          <button id="tree-zoom-in" type="button" title="Zoom in tree">+</button>
        </div>
        <div class="jp-ai-assistant-tree-legend">
          Square nodes are code cells. Circle nodes are markdown cells.
        </div>
        <div id="notebook-tree">
          <div class="jp-ai-assistant-tree-empty">
            Open a notebook and click refresh.
          </div>
        </div>



        <h3>Notebook Cells</h3>
        <div id="cell-list">
          Open a notebook and click refresh.
        </div>

        <div id="ai-assistant-status" class="jp-ai-assistant-status">
          ${this.escapeHtml(this.statusMessage || 'Ready.')}
        </div>

        <h3>Next-step Suggestions</h3>
        <ul>
          <li>Summarize the selected cell</li>
          <li>Suggest a possible next step</li>
          <li>Create a child cell from a suggestion</li>
        </ul>
      </div>
    `;

    const refreshButton = this.node.querySelector(
      '#refresh-notebook-info'
    ) as HTMLButtonElement;

    refreshButton.onclick = () => {
      this.updateNotebookInfo();
    };

    const summaryButton = this.node.querySelector(
      '#refresh-cell-summaries'
    ) as HTMLButtonElement;

    summaryButton.onclick = () => {
      void this.refreshSummaries();
    };

    // 切换 summary 显示方式后，只需要重新渲染 tree，不需要重新请求后端。
    const fixedModeInput = this.node.querySelector(
      '#summary-mode-fixed'
    ) as HTMLInputElement;
    const hoverModeInput = this.node.querySelector(
      '#summary-mode-hover'
    ) as HTMLInputElement;

    fixedModeInput.onchange = () => {
      this.summaryDisplayMode = 'fixed';
      this.updateNotebookInfo();
    };

    hoverModeInput.onchange = () => {
      this.summaryDisplayMode = 'hover';
      this.updateNotebookInfo();
    };

    const zoomOutButton = this.node.querySelector(
      '#tree-zoom-out'
    ) as HTMLButtonElement;
    const zoomInButton = this.node.querySelector(
      '#tree-zoom-in'
    ) as HTMLButtonElement;

    // 每次点击以 10% 为步长缩放 tree。
    zoomOutButton.onclick = () => {
      this.setTreeZoom(this.treeZoom - 0.1);
    };

    zoomInButton.onclick = () => {
      this.setTreeZoom(this.treeZoom + 0.1);
    };

    this.updateTreeZoomControls();
  }


  // 读取 notebook，刷新基本信息、cell summary 列表和可视化 tree。
  private updateNotebookInfo(): void {
    const current = this.notebookTracker.currentWidget;
    this.updateStatusMessage();

    const notebookInfo = this.node.querySelector(
      '#notebook-info'
    ) as HTMLElement;

    const cellList = this.node.querySelector('#cell-list') as HTMLElement;

    const notebookTree = this.node.querySelector('#notebook-tree') as HTMLElement;

    if (!current) {
      notebookInfo.innerHTML = 'No active notebook found.';
      cellList.innerHTML = 'Open a notebook first.';
      notebookTree.innerHTML = 'Open a notebook first.';
      return;
    }

    const notebook = current.content;
    const model = notebook.model;

    if (!model) {
      notebookInfo.innerHTML = 'Notebook model is not ready yet.';
      cellList.innerHTML = '';
      notebookTree.innerHTML = '';
      return;
    }

    const notebookName = current.context.path;
    const cellCount = model.cells.length;
    const activeCellIndex = notebook.activeCellIndex;

    notebookInfo.innerHTML = `
      <p><b>Name:</b> ${notebookName}</p>
      <p><b>Number of cells:</b> ${cellCount}</p>
      <p><b>Selected cell index:</b> ${activeCellIndex}</p>
    `;

    const items: string[] = [];

    for (let i = 0; i < cellCount; i++) {
      const cell = model.cells.get(i);
      const cellType = cell.type;

      const cellId = `${current.context.path}:${cell.id}`;
      const summary = this.summaries.get(cellId) || 'No summary generated yet.';

      items.push(`
        <li>
          <b>[${i}] ${cellType}</b><br />
          <p><b>Summary:</b> ${this.escapeHtml(summary)}</p>
        </li>
      `);
    }

    cellList.innerHTML = `<ul>${items.join('')}</ul>`;

    const treeNodes: string[] = [];

    // 将 notebook 中每个 cell 转成一个 tree node：
    // code cell 用方形，markdown cell 用圆形；node 数字对应 cell index。
    for (let i = 0; i < cellCount; i++) {
      const cell = model.cells.get(i);
      const cellType = cell.type;
      const normalizedCellType = cellType.toLowerCase();
      const cellId = `${current.context.path}:${cell.id}`;
      const summary = this.summaries.get(cellId) || 'No summary generated yet.';

      const activeClass =
        i === activeCellIndex ? ' jp-ai-assistant-tree-node-active' : '';
      // 根据 cell 类型决定 node 形状，未知类型默认按 markdown 的圆形处理。
      const nodeShapeClass =
        normalizedCellType === 'code'
          ? ' jp-ai-assistant-tree-node-code'
          : ' jp-ai-assistant-tree-node-markdown';
      // Fixed 模式：summary 固定显示在 node 右侧。
      const fixedSummaryMarkup =
        this.summaryDisplayMode === 'fixed'
          ? `<div class="jp-ai-assistant-tree-node-summary-fixed">${this.escapeHtml(
            summary
          )}</div>`
          : '';
      // Hover 模式：summary 作为 tooltip，鼠标悬浮或键盘 focus 时显示。
      const hoverSummaryMarkup =
        this.summaryDisplayMode === 'hover'
          ? `<div class="jp-ai-assistant-tree-node-tooltip">${this.escapeHtml(
            summary
          )}</div>`
          : '';

      treeNodes.push(`
        <div class="jp-ai-assistant-tree-node${activeClass}">
          <button
            class="jp-ai-assistant-tree-node-button${nodeShapeClass}"
            type="button"
            data-cell-index="${i}"
            data-cell-type="${this.escapeHtml(normalizedCellType)}"
            title="Jump to cell ${i}"
          >
            <span>${i}</span>
            ${hoverSummaryMarkup}
          </button>
          ${fixedSummaryMarkup}
        </div>
      `);
    }

    notebookTree.innerHTML = `
      <div class="jp-ai-assistant-tree">
        <div
          class="jp-ai-assistant-tree-canvas"
          style="transform: scale(${this.treeZoom}); width: ${100 / this.treeZoom}%"
        >
          <div class="jp-ai-assistant-tree-root">
            <span>Root</span>
            <strong>${this.escapeHtml(notebookName)}</strong>
            <small>${cellCount} cells</small>
          </div>
          <div class="jp-ai-assistant-tree-children">
            ${treeNodes.join('')}
          </div>
        </div>
      </div>
    `;

    // 给每个 tree node 绑定跳转事件：点击 node 后定位到 notebook 中对应 cell。
    notebookTree
      .querySelectorAll<HTMLButtonElement>(
        '.jp-ai-assistant-tree-node-button[data-cell-index]'
      )
      .forEach(button => {
        button.onclick = () => {
          const cellIndex = Number(button.dataset.cellIndex);

          if (Number.isInteger(cellIndex)) {
            void this.jumpToCell(cellIndex);
          }
        };
      });

    // 给每个 cell 添加 AI next button。
    this.attachAInextButtons();
  }

  private updateStatusMessage(): void {
    const status = this.node.querySelector('#ai-assistant-status') as HTMLElement;

    if (status) {
      status.textContent = this.statusMessage || 'Ready.';
    }
  }

  // notebook 中选中 cell 后，自动把侧边栏 tree 中对应 node 滚动到可见区域。
  // 如果 tree 中没有对应 node，就直接忽略。
  private scrollActiveTreeNodeIntoView(): void {
    const current = this.notebookTracker.currentWidget;
    const activeCellIndex = current?.content.activeCellIndex;

    if (activeCellIndex === undefined || activeCellIndex < 0) {
      return;
    }

    const activeNode = this.node.querySelector<HTMLButtonElement>(
      `.jp-ai-assistant-tree-node-button[data-cell-index="${activeCellIndex}"]`
    );

    activeNode?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth'
    });
  }

  // 限制 tree 缩放范围，避免缩得太小看不清或放得太大撑破侧边栏。
  private setTreeZoom(nextZoom: number): void {
    this.treeZoom = Math.min(1.6, Math.max(0.7, Number(nextZoom.toFixed(1))));
    this.updateTreeZoomControls();
    this.updateNotebookInfo();
  }

  // 同步缩放按钮状态和当前百分比显示。
  private updateTreeZoomControls(): void {
    const zoomValue = this.node.querySelector('#tree-zoom-value') as HTMLElement;
    const zoomOutButton = this.node.querySelector(
      '#tree-zoom-out'
    ) as HTMLButtonElement;
    const zoomInButton = this.node.querySelector(
      '#tree-zoom-in'
    ) as HTMLButtonElement;

    if (zoomValue) {
      zoomValue.textContent = `${Math.round(this.treeZoom * 100)}%`;
    }

    if (zoomOutButton) {
      zoomOutButton.disabled = this.treeZoom <= 0.7;
    }

    if (zoomInButton) {
      zoomInButton.disabled = this.treeZoom >= 1.6;
    }
  }

  // 跳转到 notebook 中对应的 cell，并把它滚动到视图中央。
  private async jumpToCell(cellIndex: number): Promise<void> {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;

    if (!current || !model || cellIndex < 0 || cellIndex >= model.cells.length) {
      return;
    }

    current.content.activeCellIndex = cellIndex;
    current.activate();
    current.content.activate();
    await current.content.scrollToItem(cellIndex, 'center');
    this.updateNotebookInfo();
    this.scrollActiveTreeNodeIntoView();
  }

  private getCurrentCells(): ICellDescriptor[] {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;
    const cells: ICellDescriptor[] = [];

    if (!current || !model) {
      return cells;
    }

    for (let i = 0; i < model.cells.length; i++) {
      const cell = model.cells.get(i);

      cells.push({
        cellId: `${current.context.path}:${cell.id}`,
        cellIndex: i,
        cellType: cell.type,
        source: cell.sharedModel.getSource()
      });
    }

    return cells;
  }

  private async refreshSummaries(): Promise<void> {
    const cells = this.getCurrentCells();

    for (const cell of cells) {
      const response = await summarizeCell(this.serverSettings, cell);
      //console.log(cell.cellIndex, response.summary);
      this.summaries.set(cell.cellId, response.summary);
    }
    this.updateNotebookInfo();
  }


  //AI next button：给当前notebook的每个cell旁边添加一个AInext按钮
  private attachAInextButtons(): void {
    const current = this.notebookTracker.currentWidget;

    if (!current) { return; }

    window.setTimeout(
      () => {
        current.content.widgets.forEach(
          (cellWidget, index) => {
            const cellNode = cellWidget.node;
            cellNode.classList.add('jp-ai-assistant-cell-with-ai-next');

            let button = cellNode.querySelector(
              '.jp-ai-assistant-ai-next-button'
            ) as HTMLButtonElement | null;

            if (!button) {
              button = document.createElement('button');
              button.className = 'jp-ai-assistant-ai-next-button';
              button.type = 'button';
              button.textContent = 'AI Next';
              button.dataset.lmSuppressShortcuts = 'true';
              cellNode.appendChild(button);
            }

            const cells = this.getCurrentCells();
            const cell = cells[index];
            button.disabled =
              !!cell && this.pendingSuggestionCellID === cell.cellId;

            button.onmousedown = event => {
              event.preventDefault();
              event.stopPropagation();
            };

            button.onclick = event => {
              event.preventDefault();
              event.stopPropagation();

              void this.requestSuggestionsForCell(current, index);
            }
          }
        )
      }
    )
  }
  //点击AI next button后的逻辑
  private async requestSuggestionsForCell(
    panel: NotebookPanel,
    cellIndex: number
  ): Promise<void> {
    const cells = this.getCurrentCells();//获取notebooks中所有cell信息
    const selectedCell = cells[cellIndex];//获取点击的cell信息

    if (!selectedCell) {
      return;
    }

    this.pendingSuggestionCellID = selectedCell.cellId;
    this.statusMessage = `Generating next-step suggestion for cell ${cellIndex}.`;
    this.updateNotebookInfo();


    const cellsWithSummaries = cells.map(cells => (
      {
        ...cells,
        summary: this.summaries.get(cells.cellId)
      }));

    const tree: ITreeNode[] = cellsWithSummaries.map(cell => ({
      id: cell.cellId,
      cellIndex: cell.cellIndex,
      cellType: cell.cellType,
      summary: cell.summary
    }));

    const response = await suggestNextSteps(this.serverSettings, selectedCell, {
      previousCells: cellsWithSummaries.slice(0, cellIndex),
      nextCells: cellsWithSummaries.slice(cellIndex + 1),
      tree
    });

    this.suggestions.set(selectedCell.cellId, response.suggestions);
    const savedSuggestions = this.suggestions.get(selectedCell.cellId) ?? [];
    this.pendingSuggestionCellID = '';
    this.statusMessage = `Generated ${savedSuggestions.length} suggestions for cell ${cellIndex}.`;
    this.updateNotebookInfo();

  }


  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'ai-assistant-extension:plugin',
  description: 'An AI-assisted extension for JupyterLab notebooks.',
  autoStart: true,

  requires: [INotebookTracker],

  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    console.log('AI Assistant Extension activated!');

    const panel = new AIAssistantPanel(
      notebookTracker,
      app.serviceManager.serverSettings
    );

    app.shell.add(panel, 'left', { rank: 600 });
    app.shell.activateById(panel.id);
  }
};

export default plugin;
