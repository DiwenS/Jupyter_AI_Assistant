import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import type * as nbformat from '@jupyterlab/nbformat';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import { ServerConnection } from '@jupyterlab/services';
import {
  ICellDescriptor,
  ICellSummaryData,
  ICellSummaryResponse,
  INextStepContext,
  ISuggestion,
  ITreeNode,
  summarizeCell,
  suggestNextSteps,
  selectSuggestion
} from './api';

// Tree 中 node summary 的两种显示方式：固定显示或 hover 悬浮显示。
type SummaryDisplayMode = 'fixed' | 'hover';
type GeneratedCellType = 'code' | 'markdown' | 'raw';
const ROOT_TREE_PARENT_ID = 'ROOT';
type IGeneratedCellData = (
  | Partial<nbformat.ICodeCell>
  | Partial<nbformat.IMarkdownCell>
  | Partial<nbformat.IRawCell>
) & {
  cell_type: GeneratedCellType;
  source: string;
};

class AIAssistantPanel extends Widget {
  private notebookTracker: INotebookTracker;
  //添加serversetting方便之后调用 summarizeCell(this.serverSettings, cell)
  private serverSettings: ServerConnection.ISettings;
  private summaries = new Map<string, ICellSummaryData>();

  //AI next button 需要的 suggestions 数据结构，key 是 cellId，value 是对应的建议列表。
  private suggestions = new Map<string, ISuggestion[]>();
  private pendingSuggestionCellID = '';
  private statusMessage = '';
  // selected/generated suggestion state uses sourceCellId + suggestionId as key.
  private generatedSuggestions = new Map<string, ISuggestion>(); // 储存后端返回的带真实 content 的 suggestion
  private generatedCellIds = new Map<string, string>(); // source cellId + suggestionId -> generated child cell id
  private observedPanels = new Set<NotebookPanel>();

  // 保存用户当前选择的 summary 显示模式，重新渲染 tree 时保持一致。
  private summaryDisplayMode: SummaryDisplayMode = 'fixed';
  // 保存 tree 的缩放比例，1 表示 100%。
  private treeZoom = 1;

  constructor(
    notebookTracker: INotebookTracker,
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

    // 切换 notebook 时：等 model 加载完再读缓存。
    this.notebookTracker.currentChanged.connect(() => {
      this.summaries.clear();
      this.suggestions.clear();
      this.generatedSuggestions.clear();
      this.generatedCellIds.clear();

      const current = this.notebookTracker.currentWidget;
      if (current) {
        this.observePanelChanges(current);
        // context.ready 确保 .ipynb 文件已经从磁盘读入 model
        void current.context.ready.then(() => {
          this.loadCacheFromNotebook();
          this.updateNotebookInfo();
        });
      } else {
        this.updateNotebookInfo();
      }
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

        <button id="clear-cache">
          Clear cache
        </button>

        <div id="cache-status" style="font-size:12px;margin:4px 0;color:#2196f3;"></div>        <hr />
        
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

    const clearCacheButton = this.node.querySelector(
      '#clear-cache'
    ) as HTMLButtonElement;

    clearCacheButton.onclick = () => {
      this.summaries.clear();
      this.suggestions.clear();
      const current = this.notebookTracker.currentWidget;
      if (current?.content.model) {
        (current.content.model.sharedModel as any).deleteMetadata('ai_assistant_cache');
      }
      this.statusMessage = 'Cache cleared.';
      this.updateNotebookInfo();
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
    console.log('updateNotebookInfo');
    const current = this.notebookTracker.currentWidget;
    this.updateStatusMessage();

    const notebookInfo = this.node.querySelector(
      '#notebook-info'
    ) as HTMLElement;

    const cellList = this.node.querySelector('#cell-list') as HTMLElement;

    const notebookTree = this.node.querySelector(
      '#notebook-tree'
    ) as HTMLElement;

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

    this.hydrateGeneratedCellRelations();
    this.pruneMissingGeneratedCells();

    // 更新缓存状态
    const cacheStatus = this.node.querySelector('#cache-status') as HTMLElement | null;
    if (cacheStatus) {
      try {
        const cacheMeta = (current.content.model as any).sharedModel.getMetadata('ai_assistant_cache');
        if (cacheMeta && cacheMeta.savedAt) {
          cacheStatus.textContent = '\u2713 Cache: ' + new Date(cacheMeta.savedAt).toLocaleString();
        } else {
          cacheStatus.textContent = 'No cache yet.';
        }
      } catch {
        cacheStatus.textContent = 'No cache yet.';
      }
    }
    // 无意义注释

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
      const summaryData = this.getSummaryData(cellId);
      const title = summaryData?.title || 'No title generated yet.';
      const summary = summaryData?.summary || 'No summary generated yet.';

      items.push(`
        <li>
          <b>[${i}] ${cellType}</b><br />
          <p><b>Title:</b> ${this.escapeHtml(title)}</p>
          <p><b>Summary:</b> ${this.escapeHtml(summary)}</p>
        </li>
      `);
    }

    cellList.innerHTML = `<ul>${items.join('')}</ul>`;

    const treeNodes: string[] = [];
    const generatedCellIdSet = new Set(this.generatedCellIds.values());
    const childCellIdSet = this.getTreeChildCellIds(current);
    const renderTreeNode = (
      cellId: string,
      cellIndex: number,
      cellType: string,
      summary: string,
      isGenerated: boolean
    ): string => {
      const normalizedCellType = cellType.toLowerCase();
      const activeClass =
        cellIndex === activeCellIndex
          ? ' jp-ai-assistant-tree-node-active'
          : '';
      const generatedClass = isGenerated
        ? ' jp-ai-assistant-tree-node-generated'
        : '';
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

      return `
        <div class="jp-ai-assistant-tree-node${activeClass}${generatedClass}">
          <button
            class="jp-ai-assistant-tree-node-button${nodeShapeClass}"
            type="button"
            data-cell-index="${cellIndex}"
            data-cell-id="${this.escapeHtml(cellId)}"
            data-cell-type="${this.escapeHtml(normalizedCellType)}"
            draggable="true"
            title="Jump to cell ${cellIndex}"
          >
            <span>${cellIndex}</span>
            ${isGenerated ? '<small>AI</small>' : ''}
            ${hoverSummaryMarkup}
          </button>
          ${fixedSummaryMarkup}
        </div>
      `;
    };

    // 将没有 parent 的 cell 作为主干节点；有 parent 的节点递归显示为子节点。
    for (let i = 0; i < cellCount; i++) {
      const cell = model.cells.get(i);
      const cellId = `${current.context.path}:${cell.id}`;

      if (childCellIdSet.has(cellId)) {
        continue;
      }

      const cellType = cell.type;
      const summary =
        this.getSummaryData(cellId)?.summary || 'No summary generated yet.';
      const childNodes = this.renderChildTreeNodes(
        current,
        cellId,
        renderTreeNode
      );

      treeNodes.push(`
        <div class="jp-ai-assistant-tree-family">
          ${renderTreeNode(cellId, i, cellType, summary, generatedCellIdSet.has(cellId))}
          ${childNodes}
        </div>
      `);
    }

    notebookTree.innerHTML = `
      <div class="jp-ai-assistant-tree">
        <div
          class="jp-ai-assistant-tree-canvas"
          style="transform: scale(${this.treeZoom}); width: ${100 / this.treeZoom}%"
        >
          <div class="jp-ai-assistant-tree-root" data-tree-root="true">
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
    this.attachTreeDragHandlers(notebookTree);

    // 给每个 cell 添加 AI next button。
    this.attachAInextButtons();

    // 同步显示当前cell 的 suggestions。
    this.syncCellSuggestions();
  }

  private renderChildTreeNodes(
    panel: NotebookPanel,
    sourceCellId: string,
    renderTreeNode: (
      cellId: string,
      cellIndex: number,
      cellType: string,
      summary: string,
      isGenerated: boolean
    ) => string,
    visitedCellIds = new Set<string>()
  ): string {
    const model = panel.content.model;
    const childNodes: string[] = [];

    if (!model || visitedCellIds.has(sourceCellId)) {
      return '';
    }

    visitedCellIds.add(sourceCellId);

    for (let index = 0; index < model.cells.length; index++) {
      const childCell = model.cells.get(index);
      const childCellId = `${panel.context.path}:${childCell.id}`;
      const parentId = this.getContextTreeParentId(childCellId);

      if (
        parentId !== sourceCellId ||
        visitedCellIds.has(childCellId)
      ) {
        continue;
      }

      const generatedCellIndex = this.findCellIndexByCellId(panel, childCellId);

      if (generatedCellIndex < 0) {
        continue;
      }

      const generatedCell = model.cells.get(generatedCellIndex);
      const generatedSuggestion =
        this.findGeneratedSuggestionByCellId(childCellId);
      const summary =
        generatedSuggestion?.title ||
        this.getSummaryData(childCellId)?.summary ||
        'No summary generated yet.';
      const nestedChildNodes = this.renderChildTreeNodes(
        panel,
        childCellId,
        renderTreeNode,
        new Set(visitedCellIds)
      );

      childNodes.push(`
        <div class="jp-ai-assistant-tree-family">
          ${renderTreeNode(
        childCellId,
        generatedCellIndex,
        generatedCell.type,
        summary,
        this.isGeneratedCellId(childCellId)
      )}
          ${nestedChildNodes}
        </div>
      `);
    }

    if (childNodes.length === 0) {
      return '';
    }

    return `
      <div class="jp-ai-assistant-tree-generated-children">
        ${childNodes.join('')}
      </div>
    `;
  }

  // 收集所有有 parent 的 cell，渲染主干时避免重复显示。
  private getTreeChildCellIds(panel: NotebookPanel): Set<string> {
    const childCellIds = new Set<string>();
    const model = panel.content.model;

    if (!model) {
      return childCellIds;
    }

    const existingCellIds = new Set<string>();

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);
      existingCellIds.add(`${panel.context.path}:${cell.id}`);
    }

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);
      const cellId = `${panel.context.path}:${cell.id}`;
      const parentId = this.getContextTreeParentId(cellId);

      if (
        parentId !== ROOT_TREE_PARENT_ID &&
        parentId !== cellId &&
        existingCellIds.has(parentId)
      ) {
        childCellIds.add(cellId);
      }
    }

    return childCellIds;
  }

  // 根据 generated cell id 找到对应 suggestion，用于显示生成节点标题。
  private findGeneratedSuggestionByCellId(cellId: string): ISuggestion | undefined {
    for (const [suggestionKey, generatedCellId] of this.generatedCellIds) {
      if (generatedCellId === cellId) {
        return this.generatedSuggestions.get(suggestionKey);
      }
    }

    return undefined;
  }

  // 给 tree node 绑定拖拽事件，拖到另一个 node 上时更新 tree parent metadata。
  private attachTreeDragHandlers(notebookTree: HTMLElement): void {
    const rootNode = notebookTree.querySelector<HTMLElement>(
      '.jp-ai-assistant-tree-root[data-tree-root]'
    );

    if (rootNode) {
      rootNode.ondragover = event => {
        event.preventDefault();
        rootNode.classList.add('jp-ai-assistant-tree-root-drop-target');
      };

      rootNode.ondragleave = () => {
        rootNode.classList.remove('jp-ai-assistant-tree-root-drop-target');
      };

      rootNode.ondrop = event => {
        event.preventDefault();
        rootNode.classList.remove('jp-ai-assistant-tree-root-drop-target');

        const draggedCellId = event.dataTransfer?.getData('text/plain');

        if (draggedCellId) {
          this.reparentTreeNode(draggedCellId, null);
        }
      };
    }

    notebookTree
      .querySelectorAll<HTMLButtonElement>('.jp-ai-assistant-tree-node-button')
      .forEach(button => {
        button.ondragstart = event => {
          if (!button.dataset.cellId) {
            return;
          }

          event.dataTransfer?.setData('text/plain', button.dataset.cellId);
          event.dataTransfer?.setDragImage(button, 28, 28);
        };

        button.ondragover = event => {
          event.preventDefault();
          button.classList.add('jp-ai-assistant-tree-node-drop-target');
        };

        button.ondragleave = () => {
          button.classList.remove('jp-ai-assistant-tree-node-drop-target');
        };

        button.ondrop = event => {
          event.preventDefault();
          button.classList.remove('jp-ai-assistant-tree-node-drop-target');

          const draggedCellId = event.dataTransfer?.getData('text/plain');
          const targetCellId = button.dataset.cellId;

          if (draggedCellId && targetCellId) {
            this.reparentTreeNode(draggedCellId, targetCellId);
          }
        };
      });
  }

  // 写入手动 tree parent，避免把节点拖成自己的子孙节点。
  private reparentTreeNode(childCellId: string, parentCellId: string | null): void {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;

    if (!current || !model || childCellId === parentCellId) {
      return;
    }

    if (
      parentCellId &&
      this.isTreeDescendant(current, parentCellId, childCellId)
    ) {
      this.statusMessage = 'Cannot move a node under its own child.';
      this.updateNotebookInfo();
      return;
    }

    const childIndex = this.findCellIndexByCellId(current, childCellId);

    if (childIndex < 0) {
      return;
    }

    const childCell = model.cells.get(childIndex);
    childCell.sharedModel.setMetadata(
      'ai_assistant_tree_parent_cell_id',
      parentCellId ? this.getRawCellId(parentCellId) : ''
    );
    this.statusMessage = parentCellId
      ? `Moved cell ${childIndex} under another tree node.`
      : `Moved cell ${childIndex} under Root.`;
    void current.context.save();
    this.updateNotebookInfo();
  }

  // 判断 candidate 是否已经是 source 的子孙，防止拖拽后形成循环树。
  private isTreeDescendant(
    panel: NotebookPanel,
    candidateCellId: string,
    sourceCellId: string
  ): boolean {
    const model = panel.content.model;

    if (!model) {
      return false;
    }

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);
      const cellId = `${panel.context.path}:${cell.id}`;

      if (this.getContextTreeParentId(cellId) !== sourceCellId) {
        continue;
      }

      if (
        cellId === candidateCellId ||
        this.isTreeDescendant(panel, candidateCellId, cellId)
      ) {
        return true;
      }
    }

    return false;
  }

  private updateStatusMessage(): void {
    const status = this.node.querySelector(
      '#ai-assistant-status'
    ) as HTMLElement;

    if (status) {
      status.textContent = this.statusMessage || 'Ready.';
    }
  }

  // 监听 notebook 内容变化，同步删除/插入 cell 后的前端状态。
  private observePanelChanges(panel: NotebookPanel): void {
    if (this.observedPanels.has(panel)) {
      return;
    }

    this.observedPanels.add(panel);
    panel.content.modelContentChanged.connect(() => {
      this.pruneMissingGeneratedCells();
      this.updateNotebookInfo();
    });
  }

  // 清理已被用户删除的 generated cell，避免 suggestion 继续误高亮。
  private pruneMissingGeneratedCells(): void {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;

    if (!current || !model) {
      return;
    }

    const existingCellIds = new Set<string>();

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);
      existingCellIds.add(`${current.context.path}:${cell.id}`);
    }

    this.generatedCellIds.forEach((generatedCellId, suggestionKey) => {
      if (existingCellIds.has(generatedCellId)) {
        return;
      }

      this.generatedCellIds.delete(suggestionKey);
      this.generatedSuggestions.delete(suggestionKey);
    });
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
    const zoomValue = this.node.querySelector(
      '#tree-zoom-value'
    ) as HTMLElement;
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

    if (
      !current ||
      !model ||
      cellIndex < 0 ||
      cellIndex >= model.cells.length
    ) {
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
      const cellId = `${current.context.path}:${cell.id}`;
      const summaryData = this.getSummaryData(cellId);

      cells.push({
        cellId,
        cellIndex: i,
        cellType: cell.type,
        source: cell.sharedModel.getSource(),
        title: summaryData?.title,
        summary: summaryData?.summary
      });
    }

    return cells;
  }

  // 复用 suggest-next-steps 的 context 格式，给后端提供当前 notebook 上下文。
  private buildNotebookContext(cellIndex: number): INextStepContext {
    const cells = this.getCurrentCells();
    const tree = this.buildContextTree(cells);
    // 限制前后cell的最大传输数量
    return {
      //previousCells: cellsWithSummaries.slice(0, cellIndex),
      previousCells: cells.slice(Math.max(0, cellIndex - 5), cellIndex),
      //nextCells: cellsWithSummaries.slice(cellIndex + 1),
      nextCells: cells.slice(cellIndex + 1, cellIndex + 4),
      tree
    };
  }

  // 构造真正的 tree context：根节点在第一层，子节点放进 parent 的 children。
  private buildContextTree(cells: ICellDescriptor[]): ITreeNode[] {
    const nodeMap = new Map<string, ITreeNode>();
    const rootNodes: ITreeNode[] = [];

    cells.forEach(cell => {
      const parentId = this.getContextTreeParentId(cell.cellId);

      nodeMap.set(cell.cellId, {
        id: cell.cellId,
        cellIndex: cell.cellIndex,
        cellType: cell.cellType,
        title: cell.title,
        summary: cell.summary,
        isGenerated: this.isGeneratedCellId(cell.cellId),
        parentId,
        children: []
      });
    });

    nodeMap.forEach(node => {
      const parentNode =
        node.parentId === ROOT_TREE_PARENT_ID
          ? undefined
          : nodeMap.get(node.parentId);

      if (!parentNode || parentNode.id === node.id) {
        rootNodes.push(node);
        return;
      }

      parentNode.children = parentNode.children ?? [];
      parentNode.children.push(node);
    });

    return rootNodes;
  }

  // 从 cell metadata 读取 tree parent，用完整 cell id 返回给后端。
  private getContextTreeParentId(cellId: string): string {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;

    if (!current || !model) {
      return ROOT_TREE_PARENT_ID;
    }

    const cellIndex = this.findCellIndexByCellId(current, cellId);

    if (cellIndex < 0) {
      return ROOT_TREE_PARENT_ID;
    }

    const metadata = model.cells.get(cellIndex).sharedModel.getMetadata();
    const manualParentRawCellId = metadata.ai_assistant_tree_parent_cell_id;
    const generatedParentRawCellId = metadata.ai_assistant_parent_cell_id;
    const parentRawCellId =
      typeof manualParentRawCellId === 'string'
        ? manualParentRawCellId
        : generatedParentRawCellId;

    if (typeof parentRawCellId !== 'string' || !parentRawCellId) {
      return ROOT_TREE_PARENT_ID;
    }

    return `${current.context.path}:${parentRawCellId}`;
  }

  // 标记 context tree 中哪些节点是由 suggestion 生成的 cell。
  private isGeneratedCellId(cellId: string): boolean {
    return Array.from(this.generatedCellIds.values()).includes(cellId);
  }

  // 兼容后端返回 object、JSON 字符串和旧版纯文本 summary。
  private normalizeSummaryData(rawSummary: unknown): ICellSummaryData {
    if (typeof rawSummary === 'object' && rawSummary !== null) {
      const summaryObject = rawSummary as Record<string, unknown>;
      return {
        title: this.limitSummaryTitle(
          typeof summaryObject.title === 'string' ? summaryObject.title : ''
        ),
        summary:
          typeof summaryObject.summary === 'string'
            ? summaryObject.summary
            : ''
      };
    }

    if (typeof rawSummary === 'string') {
      try {
        return this.normalizeSummaryData(JSON.parse(rawSummary));
      } catch {
        return {
          title: '',
          summary: rawSummary
        };
      }
    }

    return {
      title: '',
      summary: ''
    };
  }

  // 兼容 title/summary 位于 response 顶层，或 summary 字段内部为 JSON 的两种格式。
  private normalizeSummaryResponse(
    response: ICellSummaryResponse
  ): ICellSummaryData {
    const summaryData = this.normalizeSummaryData(response.summary);
    const title =
      typeof response.title === 'string' && response.title.trim()
        ? response.title
        : summaryData.title;

    return {
      title: this.limitSummaryTitle(title),
      summary: summaryData.summary
    };
  }

  private getSummaryData(cellId: string): ICellSummaryData | undefined {
    return this.summaries.get(cellId);
  }

  // 前端兜底限制 title 最多 5 个单词，和后端约定保持一致。
  private limitSummaryTitle(title: string): string {
    return title.trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  }

  // ── 从 notebook metadata 加载缓存 ───────────────────────────────────
  private loadCacheFromNotebook(): void {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;
    if (!current || !model) {
      console.log('[AI Assistant] loadCache: no current widget or model');
      return;
    }

    let meta: any = null;
    try {
      meta = (model.sharedModel as any).getMetadata('ai_assistant_cache');
    } catch (e) {
      console.log('[AI Assistant] loadCache: getMetadata failed', e);
      return;
    }

    if (!meta) {
      console.log('[AI Assistant] loadCache: no cache found in metadata');
      return;
    }

    const notebookPath = current.context.path;
    console.log('[AI Assistant] loadCache: found cache, notebookPath =', notebookPath);
    console.log('[AI Assistant] loadCache: summaries keys =', Object.keys(meta.summaries || {}));

    if (meta.summaries) {
      for (const [rawCellId, summary] of Object.entries(meta.summaries)) {
        this.summaries.set(
          `${notebookPath}:${rawCellId}`,
          this.normalizeSummaryData(summary)
        );
      }
    }

    if (meta.suggestions) {
      for (const [rawCellId, sugs] of Object.entries(meta.suggestions)) {
        this.suggestions.set(`${notebookPath}:${rawCellId}`, sugs as ISuggestion[]);
      }
    }

    console.log('[AI Assistant] Cache loaded! summaries count =', this.summaries.size);
  }

  // ── 把缓存写入 notebook metadata ──────────────────────────────────────
  private saveCacheToNotebook(): void {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;
    if (!current || !model) {
      return;
    }

    const notebookPath = current.context.path;

    const summariesPlain: Record<string, ICellSummaryData> = {};
    this.summaries.forEach((summary, cellId) => {
      if (cellId.startsWith(`${notebookPath}:`)) {
        const rawCellId = this.getRawCellId(cellId);
        summariesPlain[rawCellId] = summary;
      }
    });

    const suggestionsPlain: Record<string, any[]> = {};
    this.suggestions.forEach((sugs, cellId) => {
      if (cellId.startsWith(`${notebookPath}:`)) {
        const rawCellId = this.getRawCellId(cellId);
        suggestionsPlain[rawCellId] = sugs;
      }
    });

    try {
      (model.sharedModel as any).setMetadata(
        'ai_assistant_cache',
        JSON.parse(JSON.stringify({
          summaries: summariesPlain,
          suggestions: suggestionsPlain,
          savedAt: new Date().toISOString()
        }))
      );
      console.log('[AI Assistant] Cache saved to notebook metadata.');
    } catch (e) {
      console.error('[AI Assistant] Failed to save cache:', e);
    }
  }

  private async refreshSummaries(): Promise<void> {
    const cells = this.getCurrentCells();

    for (const cell of cells) {
      const response = await summarizeCell(this.serverSettings, cell);
      const summaryData = this.normalizeSummaryResponse(response);
      console.log('[AI Assistant] summarize-cell response:', response);
      console.log('[AI Assistant] normalized summary data:', summaryData);
      this.summaries.set(cell.cellId, summaryData);
    }
    this.saveCacheToNotebook();
    this.updateNotebookInfo();
  }

  //AI next button：给当前notebook的每个cell旁边添加一个AInext按钮
  private attachAInextButtons(): void {
    const current = this.notebookTracker.currentWidget;

    if (!current) {
      return;
    }

    window.setTimeout(() => {
      current.content.widgets.forEach((cellWidget, index) => {
        const cellNode = cellWidget.node;
        cellNode.classList.add('jp-ai-assistant-cell-with-ai-next');
        const buttonHost =
          (cellNode.querySelector(
            '.jp-Cell-inputWrapper'
          ) as HTMLElement | null) ??
          (cellNode.querySelector('.jp-InputArea') as HTMLElement | null) ??
          cellNode;
        buttonHost.classList.add('jp-ai-assistant-ai-next-host');

        let button = cellNode.querySelector(
          '.jp-ai-assistant-ai-next-button'
        ) as HTMLButtonElement | null;

        if (!button) {
          button = document.createElement('button');
          button.className = 'jp-ai-assistant-ai-next-button';
          button.type = 'button';
          button.textContent = 'AI Next';
          button.dataset.lmSuppressShortcuts = 'true';
        }

        if (button.parentElement !== buttonHost) {
          buttonHost.appendChild(button);
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
        };
      });
    });
  }
  //点击AI next button后的逻辑
  private async requestSuggestionsForCell(
    panel: NotebookPanel,
    cellIndex: number
  ): Promise<void> {
    const cells = this.getCurrentCells(); //获取notebooks中所有cell信息
    const selectedCell = cells[cellIndex]; //获取点击的cell信息

    if (!selectedCell) {
      return;
    }

    this.pendingSuggestionCellID = selectedCell.cellId;
    this.statusMessage = `Generating next-step suggestion for cell ${cellIndex}.`;
    this.updateNotebookInfo();

    const context = this.buildNotebookContext(cellIndex);
    const response = await suggestNextSteps(
      this.serverSettings,
      selectedCell,
      context
    );

    // 重新请求 AI Next 时，只保留仍有关联 generated cell 的旧 suggestions。
    this.pruneMissingGeneratedCells();
    const generatedSuggestions = this.getGeneratedSuggestionsForCell(
      selectedCell.cellId
    );
    const nextSuggestions = response.suggestions.map((suggestion, index) =>
      this.withClientSuggestionKey(selectedCell.cellId, suggestion, index)
    );
    this.suggestions.set(selectedCell.cellId, [
      ...generatedSuggestions,
      ...nextSuggestions
    ]);
    const savedSuggestions = this.suggestions.get(selectedCell.cellId) ?? [];
    this.pendingSuggestionCellID = '';
    this.statusMessage = `Generated ${savedSuggestions.length} suggestions for cell ${cellIndex}.`;
    this.saveCacheToNotebook();
    this.updateNotebookInfo();
  }
  //显示具体的suggestions
  private syncCellSuggestions(): void {
    const current = this.notebookTracker.currentWidget;

    if (!current) {
      return;
    }

    window.setTimeout(() => {
      const cells = this.getCurrentCells();

      current.content.widgets.forEach((cellWidget, index) => {
        const cell = cells[index];

        if (!cell) {
          return;
        }

        const suggestions = this.suggestions.get(cell.cellId) ?? [];
        const cellNode = cellWidget.node;

        let panel = cellNode.querySelector(
          '.jp-ai-assistant-cell-suggestions'
        ) as HTMLDivElement | null;

        if (suggestions.length === 0) {
          panel?.remove();
          return;
        }

        if (!panel) {
          panel = document.createElement('div');
          panel.className = 'jp-ai-assistant-cell-suggestions';
          cellNode.appendChild(panel);
        }

        panel.textContent = '';

        const title = document.createElement('div');
        title.className = 'jp-ai-assistant-cell-suggestions-title';
        title.textContent = 'Next-step suggestions';
        panel.appendChild(title);

        suggestions.forEach(suggestion => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'jp-ai-assistant-suggestion-option';
          option.dataset.lmSuppressShortcuts = 'true';

          if (
            this.generatedCellIds.has(
              this.createSuggestionKey(
                cell.cellId,
                this.getSuggestionIdentity(suggestion)
              )
            )
          ) {
            option.classList.add('jp-ai-assistant-suggestion-option-selected');
          }

          option.onmousedown = event => {
            event.preventDefault();
            event.stopPropagation();
          };

          // 点击后调用 selectSuggestionForCell()
          option.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            void this.selectSuggestionForCell(cell, suggestion);
          };

          const optionTitle = document.createElement('strong');
          optionTitle.textContent = suggestion.title;
          option.appendChild(optionTitle);

          const optionDescription = document.createElement('span');
          optionDescription.className =
            'jp-ai-assistant-suggestion-description';
          optionDescription.textContent = suggestion.description;
          option.appendChild(optionDescription);

          panel.appendChild(option);
        });

        // 允许用户在 AI suggestions 之外手动补充一条 suggestion。
        this.renderCustomSuggestionInput(panel, cell);
      });
    }, 0);
  }

  private renderCustomSuggestionInput(
    panel: HTMLDivElement,
    cell: ICellDescriptor
  ): void {
    const customRow = document.createElement('div');
    customRow.className = 'jp-ai-assistant-custom-suggestion';

    const inputGroup = document.createElement('div');
    inputGroup.className = 'jp-ai-assistant-custom-suggestion-fields';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'jp-ai-assistant-custom-suggestion-input';
    titleInput.placeholder = 'Suggestion title';
    titleInput.dataset.lmSuppressShortcuts = 'true';

    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.className = 'jp-ai-assistant-custom-suggestion-input';
    descriptionInput.placeholder = 'Suggestion description';
    descriptionInput.dataset.lmSuppressShortcuts = 'true';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'jp-ai-assistant-custom-suggestion-button';
    addButton.textContent = 'Add';
    addButton.dataset.lmSuppressShortcuts = 'true';

    const addCustomSuggestion = () => {
      const customTitle = titleInput.value.trim();
      const customDescription = descriptionInput.value.trim();

      if (!customTitle && !customDescription) {
        return;
      }

      this.addCustomSuggestionForCell(cell, customTitle, customDescription);
    };

    const stopNotebookFocus = (event: MouseEvent) => {
      event.stopPropagation();
    };
    const submitOnEnter = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        addCustomSuggestion();
      }
    };

    titleInput.onmousedown = stopNotebookFocus;
    descriptionInput.onmousedown = stopNotebookFocus;
    titleInput.onkeydown = submitOnEnter;
    descriptionInput.onkeydown = submitOnEnter;

    addButton.onmousedown = event => {
      event.preventDefault();
      event.stopPropagation();
    };

    addButton.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      addCustomSuggestion();
    };

    inputGroup.appendChild(titleInput);
    inputGroup.appendChild(descriptionInput);
    customRow.appendChild(inputGroup);
    customRow.appendChild(addButton);
    panel.appendChild(customRow);
  }

  // 将用户输入包装成后端 select-suggestion 接口可接收的 suggestion。
  private addCustomSuggestionForCell(
    cell: ICellDescriptor,
    customTitle: string,
    customDescription: string
  ): void {
    const title = customTitle || customDescription;
    const description = customDescription || customTitle;
    const customSuggestion = this.withClientSuggestionKey(
      cell.cellId,
      {
        id: `user-suggestion-${Date.now()}`,
        title,
        description,
        cellType: 'code',
        content: '',
        metadata: {
          source: 'user'
        }
      },
      0
    );

    this.suggestions.set(cell.cellId, [
      ...(this.suggestions.get(cell.cellId) ?? []),
      customSuggestion
    ]);
    this.statusMessage = 'Custom suggestion added.';
    this.saveCacheToNotebook();
    this.updateNotebookInfo();
  }

  private async selectSuggestionForCell(
    cell: ICellDescriptor,
    suggestion: ISuggestion
  ): Promise<void> {
    const suggestionKey = this.createSuggestionKey(
      cell.cellId,
      this.getSuggestionIdentity(suggestion)
    );
    this.pendingSuggestionCellID = cell.cellId;
    this.statusMessage = `Generating content for ${suggestion.id}.`;
    this.updateNotebookInfo();

    const context = this.buildNotebookContext(cell.cellIndex);
    const response = await selectSuggestion(
      this.serverSettings,
      cell,
      suggestion,
      context
    );
    const generatedSuggestion = {
      ...response.suggestion,
      metadata: {
        ...response.suggestion.metadata,
        ai_assistant_suggestion_key: this.getSuggestionIdentity(suggestion)
      }
    };

    this.generatedSuggestions.set(suggestionKey, generatedSuggestion);
    await this.createOrUpdateGeneratedCell(cell, generatedSuggestion);
    this.pendingSuggestionCellID = '';
    this.statusMessage = response.message;
    this.updateNotebookInfo();
  }

  private async createOrUpdateGeneratedCell(
    sourceCell: ICellDescriptor,
    suggestion: ISuggestion
  ): Promise<void> {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;

    if (!current || !model) {
      return;
    }

    const cellData = this.createGeneratedCellData(sourceCell, suggestion);
    const suggestionKey = this.createSuggestionKey(
      sourceCell.cellId,
      this.getSuggestionIdentity(suggestion)
    );
    const existingGeneratedCellId = this.generatedCellIds.get(suggestionKey);
    const existingGeneratedCellIndex = existingGeneratedCellId
      ? this.findCellIndexByCellId(current, existingGeneratedCellId)
      : -1;

    let targetIndex = existingGeneratedCellIndex;

    if (existingGeneratedCellIndex >= 0) {
      model.sharedModel.deleteCell(existingGeneratedCellIndex);
    } else {
      const sourceCellIndex = this.findCellIndexByCellId(
        current,
        sourceCell.cellId
      );

      if (sourceCellIndex < 0) {
        return;
      }

      targetIndex = this.findGeneratedCellInsertIndex(current, sourceCell);
    }

    const insertedCell = model.sharedModel.insertCell(targetIndex, cellData);
    const insertedCellId = `${current.context.path}:${insertedCell.getId()}`;
    this.generatedCellIds.set(suggestionKey, insertedCellId);

    current.content.activeCellIndex = targetIndex;
    current.activate();
    current.content.activate();
    await current.content.scrollToItem(targetIndex, 'center');
  }

  private hydrateGeneratedCellRelations(): void {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;

    if (!current || !model) {
      return;
    }

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);
      const metadata = cell.sharedModel.getMetadata();

      if (metadata.ai_assistant_generated !== true) {
        continue;
      }

      const parentRawCellId = metadata.ai_assistant_parent_cell_id;
      const suggestionId = metadata.ai_assistant_suggestion_id;

      if (
        typeof parentRawCellId !== 'string' ||
        typeof suggestionId !== 'string'
      ) {
        continue;
      }

      const parentCellId = `${current.context.path}:${parentRawCellId}`;
      const generatedCellId = `${current.context.path}:${cell.id}`;
      const suggestionIdentity =
        typeof metadata.ai_assistant_suggestion_key === 'string'
          ? metadata.ai_assistant_suggestion_key
          : suggestionId;
      const suggestionKey = this.createSuggestionKey(
        parentCellId,
        suggestionIdentity
      );
      const suggestionTitle =
        typeof metadata.ai_assistant_suggestion_title === 'string'
          ? metadata.ai_assistant_suggestion_title
          : 'Generated from selected suggestion.';

      this.generatedCellIds.set(suggestionKey, generatedCellId);

      if (!this.generatedSuggestions.has(suggestionKey)) {
        this.generatedSuggestions.set(suggestionKey, {
          id: suggestionId,
          title: suggestionTitle,
          description: '',
          cellType: cell.type,
          content: cell.sharedModel.getSource(),
          metadata: {
            source: 'metadata',
            ai_assistant_suggestion_key: suggestionIdentity
          }
        });
      }
    }
  }

  private createSuggestionKey(cellId: string, suggestionId: string): string {
    return `${cellId}::${suggestionId}`;
  }

  // 优先使用前端生成的唯一 key，避免后端复用 suggestion id 导致误高亮。
  private getSuggestionIdentity(suggestion: ISuggestion): string {
    const metadata = suggestion.metadata as Record<string, unknown>;
    const clientKey = metadata.ai_assistant_suggestion_key;

    return typeof clientKey === 'string' ? clientKey : suggestion.id;
  }

  // 给每次新返回的 suggestion 加唯一 key，用来区分不同批次建议。
  private withClientSuggestionKey(
    cellId: string,
    suggestion: ISuggestion,
    index: number
  ): ISuggestion {
    return {
      ...suggestion,
      metadata: {
        ...suggestion.metadata,
        ai_assistant_suggestion_key: `${this.getRawCellId(cellId)}-${Date.now()}-${index}-${suggestion.id}`
      }
    };
  }

  // 只保留仍然对应现存 generated cell 的旧 suggestions。
  private getGeneratedSuggestionsForCell(cellId: string): ISuggestion[] {
    return (this.suggestions.get(cellId) ?? []).filter(suggestion =>
      this.generatedCellExists(cellId, this.getSuggestionIdentity(suggestion))
    );
  }

  // 确认某条 suggestion 对应的 generated cell 是否仍在 notebook 中。
  private generatedCellExists(cellId: string, suggestionId: string): boolean {
    const current = this.notebookTracker.currentWidget;
    const model = current?.content.model;
    const generatedCellId = this.generatedCellIds.get(
      this.createSuggestionKey(cellId, suggestionId)
    );

    if (!current || !model || !generatedCellId) {
      return false;
    }

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);

      if (`${current.context.path}:${cell.id}` === generatedCellId) {
        return true;
      }
    }

    return false;
  }

  private findGeneratedCellInsertIndex(
    panel: NotebookPanel,
    sourceCell: ICellDescriptor
  ): number {
    const sourceCellIndex = this.findCellIndexByCellId(
      panel,
      sourceCell.cellId
    );

    if (sourceCellIndex < 0) {
      return 0;
    }

    let insertIndex = sourceCellIndex + 1;

    this.generatedCellIds.forEach((generatedCellId, suggestionKey) => {
      if (!suggestionKey.startsWith(`${sourceCell.cellId}::`)) {
        return;
      }

      const generatedCellIndex = this.findCellIndexByCellId(
        panel,
        generatedCellId
      );

      if (generatedCellIndex >= insertIndex) {
        insertIndex = generatedCellIndex + 1;
      }
    });

    return insertIndex;
  }

  private createGeneratedCellData(
    sourceCell: ICellDescriptor,
    suggestion: ISuggestion
  ): IGeneratedCellData {
    const cellType = this.normalizeGeneratedCellType(suggestion.cellType);
    const baseCell = {
      cell_type: cellType,
      source: suggestion.content,
      metadata: {
        ai_assistant_generated: true,
        ai_assistant_parent_cell_id: this.getRawCellId(sourceCell.cellId),
        ai_assistant_suggestion_title: suggestion.title,
        ai_assistant_suggestion_id: suggestion.id,
        ai_assistant_suggestion_key: this.getSuggestionIdentity(suggestion)
      }
    };

    if (cellType === 'code') {
      return {
        ...baseCell,
        outputs: [],
        execution_count: null
      };
    }

    return baseCell;
  }

  private normalizeGeneratedCellType(cellType: string): GeneratedCellType {
    if (cellType === 'markdown' || cellType === 'raw') {
      return cellType;
    }

    return 'code';
  }

  private getRawCellId(cellId: string): string {
    return cellId.split(':').pop() ?? cellId;
  }

  private findCellIndexByCellId(panel: NotebookPanel, cellId: string): number {
    const model = panel.content.model;

    if (!model) {
      return -1;
    }

    for (let index = 0; index < model.cells.length; index++) {
      const cell = model.cells.get(index);
      const currentCellId = `${panel.context.path}:${cell.id}`;

      if (currentCellId === cellId) {
        return index;
      }
    }

    return -1;
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
    console.log('AI Assistant Extension activated! (v3-ready-fix)');

    const panel = new AIAssistantPanel(
      notebookTracker,
      app.serviceManager.serverSettings
    );

    app.shell.add(panel, 'left', { rank: 600 });
    app.shell.activateById(panel.id);
  }
};

export default plugin;
