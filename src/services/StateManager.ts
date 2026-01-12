import * as vscode from 'vscode';
import { TabData } from '../common/types';

interface SavedState {
  tabs: Map<string, TabData>;
  resultCounter: number;
}

export class StateManager {
  private static readonly STATE_KEY = 'sqlPreview.state';

  constructor(private readonly context: vscode.ExtensionContext) {
    // Clear state on startup? For now, we persist across reloads.
    // If we wanted session-only state, we would clear here.

    // Register a disposal listener if deemed necessary, otherwise leave empty
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    context.subscriptions.push({ dispose: () => {} });
  }

  /**
   * Persists the current state of tabs and counters.
   */
  async saveState(tabs: Map<string, TabData>, resultCounter: number): Promise<void> {
    const state = {
      tabs: Array.from(tabs.entries()),
      resultCounter,
    };

    try {
      await this.context.workspaceState.update(StateManager.STATE_KEY, state);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to save state:', error);
    }
  }

  /**
   * Loads the persisted state.
   */
  async loadState(): Promise<SavedState | undefined> {
    try {
      const rawState = this.context.workspaceState.get<{
        tabs: [string, TabData][];
        resultCounter: number;
      }>(StateManager.STATE_KEY);

      if (!rawState) {
        return undefined;
      }

      return {
        tabs: new Map(rawState.tabs),
        resultCounter: rawState.resultCounter,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load state:', error);
      return undefined;
    }
  }

  /**
   * Clears the persisted state.
   */
  async clearState(): Promise<void> {
    await this.context.workspaceState.update(StateManager.STATE_KEY, undefined);
  }
}
