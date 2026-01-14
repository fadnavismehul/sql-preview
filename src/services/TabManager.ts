import * as vscode from 'vscode';
import { TabData } from '../common/types';

/**
 * Manages the state of query results tabs.
 * Emits events when tabs are added, removed, or updated.
 */
export class TabManager {
  private _tabs: Map<string, TabData> = new Map();
  private _activeTabId: string | undefined;

  private readonly _onDidTabsChange = new vscode.EventEmitter<void>();
  public readonly onDidTabsChange = this._onDidTabsChange.event;

  private readonly _onDidActiveTabChange = new vscode.EventEmitter<string | undefined>();
  public readonly onDidActiveTabChange = this._onDidActiveTabChange.event;

  public get tabs(): Map<string, TabData> {
    return this._tabs;
  }

  public get activeTabId(): string | undefined {
    return this._activeTabId;
  }

  public getTab(id: string): TabData | undefined {
    return this._tabs.get(id);
  }

  public getAllTabs(): TabData[] {
    return Array.from(this._tabs.values());
  }

  public addTab(tab: TabData): void {
    this._tabs.set(tab.id, tab);
    this._onDidTabsChange.fire();
  }

  public updateTab(id: string, updates: Partial<TabData>): void {
    const tab = this._tabs.get(id);
    if (tab) {
      Object.assign(tab, updates);
      this._tabs.set(id, tab);
      this._onDidTabsChange.fire();
    }
  }

  public removeTab(id: string): void {
    if (this._tabs.delete(id)) {
      if (this._activeTabId === id) {
        this._activeTabId = undefined;
        this._onDidActiveTabChange.fire(undefined);
      }
      this._onDidTabsChange.fire();
    }
  }

  public removeOtherTabs(keepId: string): void {
    let changed = false;
    for (const id of this._tabs.keys()) {
      if (id !== keepId) {
        this._tabs.delete(id);
        changed = true;
      }
    }
    if (this._activeTabId !== keepId) {
      this._activeTabId = keepId;
      this._onDidActiveTabChange.fire(keepId);
    }
    if (changed) {
      this._onDidTabsChange.fire();
    }
  }

  public removeAllTabs(): void {
    if (this._tabs.size > 0) {
      this._tabs.clear();
      this._activeTabId = undefined;
      this._onDidActiveTabChange.fire(undefined);
      this._onDidTabsChange.fire();
    }
  }

  public setActiveTab(id: string | undefined): void {
    if (this._activeTabId !== id) {
      this._activeTabId = id;
      this._onDidActiveTabChange.fire(id);
    }
  }

  public setTabs(tabs: Map<string, TabData>): void {
    this._tabs = tabs;
    this._onDidTabsChange.fire();
  }
}
