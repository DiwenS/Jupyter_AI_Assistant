import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import { ServerConnection } from '@jupyterlab/services';
import { ICellDescriptor, summarizeCell } from './api';

class AIAssistantPanel extends Widget {
  private notebookTracker: INotebookTracker;
  //添加serversetting方便之后调用 summarizeCell(this.serverSettings, cell)
  private serverSettings: ServerConnection.ISettings;
  private summaries = new Map<string, string>();


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

    //监听当前选择的cell并更新selected cell index
    this.notebookTracker.activeCellChanged.connect(() => {
      this.updateNotebookInfo();
    });

    this.notebookTracker.currentChanged.connect(() => {
      this.updateNotebookInfo();
    });
  }

  private render(): void {
    this.node.innerHTML = `
      <div style="padding: 14px; font-family: sans-serif; height: 100%; overflow-y: auto; box-sizing: border-box;">
        <h2>AI Notebook Assistant</h2>

        <button id="refresh-notebook-info">
          Refresh notebook info
        </button>

        <button id="refresh-cell-summaries">
          Refresh summaries
        </button>

        <hr />

        <h3>Notebook Tree</h3>
        <div id="notebook-tree">
          <ul>
            <li>
              <b>Root:</b> Current notebook
              <ul>
                <li>Cell nodes will appear here.</li>
              </ul>
            </li>
          </ul>
        </div>


        <h3>Current Notebook</h3>
        <div id="notebook-info">
          No notebook selected yet.
        </div>

        <h3>Notebook Cells</h3>
        <div id="cell-list">
          Open a notebook and click refresh.
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
  }


  //读取notebook,刷新基本信息
  private updateNotebookInfo(): void {
    const current = this.notebookTracker.currentWidget;

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

    const treeItems: string[] = [];

    for (let i = 0; i < cellCount; i++) {
      const cell = model.cells.get(i);
      const cellType = cell.type;
      const source = cell.sharedModel.getSource();

      let label = source.split('\n')[0] || '(empty cell)';
      if (label.length > 40) {
        label = label.slice(0, 40) + '...';
      }

      treeItems.push(`
        <li>
          <b>Cell ${i}</b> (${cellType}): 
          ${this.escapeHtml(label)}
        </li>
      `);
    }

    notebookTree.innerHTML = `
      <ul>
        <li>
          <b>Root:</b> ${this.escapeHtml(notebookName)}
          <ul>
            ${treeItems.join('')}
          </ul>
        </li>
      </ul>
    `;
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
