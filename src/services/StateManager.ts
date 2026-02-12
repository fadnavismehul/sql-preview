import * as vscode from 'vscode';
import { TabData } from '../common/types';
import { Logger } from '../core/logging/Logger';

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
    // Register a disposal listener if deemed necessary, otherwise leave empty
    context.subscriptions.push({
      dispose: () => {
        /* no-op */
      },
    });
  }

  /**
   * Persists the current state of tabs and counters.
   */
  async saveState(tabs: Map<string, TabData>, resultCounter: number): Promise<void> {
    // Sanitize tabs to remove heavy row data before persistence
    const sanitizedTabs = Array.from(tabs.entries()).map(([key, tab]) => {
      // Shallow clone to avoid modifying the in-memory instance
      const safeTab = { ...tab };
      // Clear rows to save storage space and improve performance
      if (safeTab.rows && safeTab.rows.length > 0) {
        safeTab.rows = [];
        safeTab.wasDataCleared = true;
      }
      return [key, safeTab] as [string, TabData];
    });

    const state = {
      tabs: sanitizedTabs,
      resultCounter,
    };

    try {
      await this.context.workspaceState.update(StateManager.STATE_KEY, state);
    } catch (error) {
      Logger.getInstance().error('Failed to save state:', error);
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
      Logger.getInstance().error('Failed to load state:', error);
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
