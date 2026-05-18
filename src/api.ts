import { ServerConnection } from '@jupyterlab/services';

import { requestAPI } from './request';

// 1. 定义接口

// 描述cell的基本信息
export interface ICellDescriptor {
    cellId: string;
    cellIndex: number;
    cellType: string;
    source: string;
    summary?: string;//？表示可选
}

// 描述后端接口summarize-cell返回的cell summary数据
export interface ICellSummaryResponse {
    status: 'success' | 'error';
    cellId: string;
    cellIndex: number | null;
    cellType: string;
    summary: string;
    details: string;
    metadata: {
        source: string;
    };
}

//一条suggestion的基本信息
export interface ISuggestion {
    id: string;
    title: string;
    description: string;
    cellType: string;
    content: string;
    metadata: {
        source: string;
    };
}

//请求后端生成建议时，前端传给后端的上下文cell信息&Tree信息
export interface INextStepContext {
    previousCells: ICellDescriptor[];
    nextCells: ICellDescriptor[];
    tree: ITreeNode[];
}

//后端生成当前cell的建议后，返回给前端的完整suggestions
export interface INextStepSuggestionsResponse {
    status: 'success' | 'error';
    suggestions: ISuggestion[];
    metadata: {
        source: string;
        contextReceived: boolean;
    };
}

// Tree的每个Node
export interface ITreeNode {
    id: string;
    cellIndex: number;
    cellType: string;
    summary?: string;
    parentId?: string; //根节点没有parentId TODO:待完善
}




/**
 TODO: 完善后端endpoint for select-suggestion
 * 返回的ISuggestion中content字段应该是generated
 */

export interface ISelectSuggestionResponse {
    status: 'success' | 'error';
    suggestion: ISuggestion;
    message: string;
    metadata: {
        source: string;
    };
}
//2. 定义api functions

//向后端summarize-cell请求当前cell的summary
export async function summarizeCell(
    serverSettings: ServerConnection.ISettings,
    cell: ICellDescriptor
): Promise<ICellSummaryResponse> {
    const response = await requestAPI<ICellSummaryResponse>(
        'summarize-cell',
        serverSettings,
        {
            method: 'POST',
            body: JSON.stringify(cell)
        }
    );

    if (response.status === 'error') {
        throw new Error('Server returned an error while summarizing the cell.');
    }

    return response;
}

//
export async function suggestNextSteps(
    serverSettings: ServerConnection.ISettings,
    selectedCell: ICellDescriptor,
    context: INextStepContext
): Promise<INextStepSuggestionsResponse> {
    const response = await requestAPI<INextStepSuggestionsResponse>(
        'suggest-next-steps',
        serverSettings,
        {
            method: 'POST',
            body: JSON.stringify({
                selectedCell,
                context
            })
        }
    );

    if (response.status === 'error') {
        throw new Error('Server returned an error while suggesting next steps.');
    }

    return response;
}

//告诉后端用户选中了哪一条suggetion
export async function selectSuggestion(
    serverSettings: ServerConnection.ISettings,
    selectedCell: ICellDescriptor,
    selectedSuggestion: ISuggestion
): Promise<ISelectSuggestionResponse> {
    const response = await requestAPI<ISelectSuggestionResponse>(
        'select-suggestion',
        serverSettings,
        {
            method: 'POST',
            body: JSON.stringify({
                selectedCell,
                selectedSuggestion
            })
        }
    );

    if (response.status === 'error') {
        throw new Error('Server returned an error while selecting suggestion.');
    }

    return response;
}