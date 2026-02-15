/**
 * Webview Script for SQL Results
 * Handles the display of query results using AG Grid Community (Free).
 */

// Initialize VS Code API
const vscode = acquireVsCodeApi();

// --- Logging & Error Handling ---
function logToHost(level, message) {
    vscode.postMessage({ command: 'logMessage', level, message });
}

window.addEventListener('error', (event) => {
    if (event.message === 'ResizeObserver loop limit exceeded') return; // Ignore harmless ResizeObserver errors

    // Resource loading errors (img, script, css)
    if (event.target && (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
        const url = event.target.src || event.target.href;
        logToHost('error', `Resource failed to load: ${url}`);
        return;
    }

    logToHost('error', `Global Error: ${event.message} at ${event.filename}:${event.lineno}`);
}, true); // Capture phase to catch resource errors

window.addEventListener('unhandledrejection', (event) => {
    logToHost('error', `Unhandled Rejection: ${event.reason}`);
});

logToHost('info', 'Webview script initialized.');

// --- State ---
const tabs = new Map();
const lastActiveTabByFile = new Map();

// --- Custom Range Selection State ---
const rangeSelection = {
    active: false,
    start: null, // { rowIndex, colIndex }
    end: null,
    tabId: null,

    clear() {
        this.active = false;
        this.start = null;
        this.end = null;
        this.tabId = null;
    }
};

// End drag on mouseup
document.addEventListener('mouseup', () => {
    if (rangeSelection.active) {
        rangeSelection.isDragging = false;
    }
});

function isRangeSelected(params) {
    if (!rangeSelection.start || !rangeSelection.end || rangeSelection.tabId !== params.api.tabId) return false;

    // Check if cell is within range
    const allCols = params.api.getAllDisplayedColumns();
    const colIdx = allCols.indexOf(params.column);
    const rowIdx = params.node.rowIndex;

    const startRow = Math.min(rangeSelection.start.rowIndex, rangeSelection.end.rowIndex);
    const endRow = Math.max(rangeSelection.start.rowIndex, rangeSelection.end.rowIndex);
    const startCol = Math.min(rangeSelection.start.colIndex, rangeSelection.end.colIndex);
    const endCol = Math.max(rangeSelection.start.colIndex, rangeSelection.end.colIndex);

    return rowIdx >= startRow && rowIdx <= endRow && colIdx >= startCol && colIdx <= endCol;
}

// Global Copy Listener
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const selection = window.getSelection();
        // If user is selecting text explicitly (text selection enabled), let browser handle it
        // BUT if we are in "range mode" (active), we should override it?
        // User wants "drag over cells and copy".
        // Screenshot 2 shows blue cell selection. Native text selection is usually gray/blue overlay text only.
        // If our custom selection is visually active, we override.
        if (rangeSelection.active) {
            // Override native copy
        } else if (selection && selection.toString().length > 0) {
            return;
        }

        let activeTab = null;
        for (const tab of tabs.values()) {
            if (tab.content.classList.contains('active')) {
                activeTab = tab;
                break;
            }
        }

        if (activeTab && activeTab.api) {
            // 1. Custom Range Selection
            if (rangeSelection.active && rangeSelection.tabId === activeTab.id && rangeSelection.start && rangeSelection.end) {
                e.preventDefault();
                copyRangeToClipboard(activeTab);
                return;
            }

            // 2. Standard Row Selection (Fallback)
            const selected = activeTab.api.getSelectedRows();
            if (selected && selected.length > 0) {
                e.preventDefault();
                const rowsArray = selected.map(rowObj => {
                    // Follow column order if possible
                    if (activeTab.columns) {
                        return activeTab.columns.map(col => rowObj[col.name]);
                    }
                    return Object.values(rowObj);
                });
                copyToClipboard(activeTab.columns || [], rowsArray, true);
            }
        }
    }
});

function copyRangeToClipboard(tab) {
    const api = tab.api;
    if (!api) return;

    // Calculate selection bounds
    const startRow = Math.min(rangeSelection.start.rowIndex, rangeSelection.end.rowIndex);
    const endRow = Math.max(rangeSelection.start.rowIndex, rangeSelection.end.rowIndex);
    const startColIdx = Math.min(rangeSelection.start.colIndex, rangeSelection.end.colIndex);
    const endColIdx = Math.max(rangeSelection.start.colIndex, rangeSelection.end.colIndex);

    // Get displayed columns to ensure visual order
    const allCols = api.getAllDisplayedColumns ? api.getAllDisplayedColumns() : []; // Safe check

    const relevantCols = [];
    const colHeaders = [];

    // Collect columns in range
    for (let c = startColIdx; c <= endColIdx; c++) {
        const col = allCols[c];
        if (col) { // Skip selector/system columns if needed? Selector is usually index 0.
            // If they select selector column, we might or might not include it. empty string renderer.
            // The selector column usually has empty header.
            // user wants data. 
            // If col id is '_rowSelector', skip it?
            if (col.getColId() !== '_rowSelector') {
                relevantCols.push(col);
                colHeaders.push({ name: col.getColDef().headerName || col.getColId() });
            }
        }
    }

    const rows = [];
    for (let r = startRow; r <= endRow; r++) {
        const rowNode = api.getDisplayedRowAtIndex(r);
        if (rowNode) {
            const rowData = relevantCols.map(col => api.getValue(col, rowNode));
            rows.push(rowData);
        }
    }

    copyToClipboard(colHeaders, rows, true);
}
let activeTabId = null;
let currentRowHeightDensity = 'normal';



// --- Elements ---
const tabList = document.getElementById('tab-list');
const tabContentContainer = document.getElementById('tab-content-container');
const newTabButton = document.getElementById('new-tab-button');
const noTabsMessage = document.getElementById('no-tabs-message');
const activeFileIndicator = document.getElementById('active-file-indicator');

// --- Icons ---
const FILTER_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M10 14h-4v-1h4v1zM13.5 10h-11v-1h11v1zM16 6h-16v-1h16v1z"/></svg>`; // Simplified filter/sort icon

// --- Event Listeners ---

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'createTab':
        case 'createTab':
            createTab(message.tabId, message.query, message.title, message.sourceFileUri, message.preserveFocus, message.index);
            break;
        case 'resultData':
            updateTabWithResults(message.tabId, message.data, message.title);
            break;
        case 'queryError':
            updateTabWithError(message.tabId, message.error, message.query, message.title);
            break;
        case 'showLoading':
            showLoading(message.tabId, message.query, message.title, message.preserveFocus);
            break;
        case 'queryCancelled':
            handleQueryCancelled(message.tabId, message.message);
            break;
        case 'reuseOrCreateActiveTab':
            handleReuseOrCreate(message.tabId, message.query, message.title, message.sourceFileUri, message.preserveFocus);
            break;
        case 'closeActiveTab':
            if (activeTabId) closeTab(activeTabId);
            break;
        case 'closeOtherTabs':
            closeOtherTabs();
            break;
        case 'closeAllTabs':
            closeAllTabs();
            break;
        case 'updateFontSize':
            document.documentElement.style.setProperty('--vscode-editor-font-size', message.fontSize);
            break;
        case 'filterTabs':
            filterTabsByFile(message.fileUri, message.fileName);
            break;
        case 'updateConnections':
            updateConnectionList(message.connections);
            break;
        case 'updateRowHeight':
            updateGridDensity(message.density);
            break;
        case 'updateVersionInfo':
            updateVersionInfo(message.currentVersion, message.latestVersion);
            break;
    }
});

// Context Menu Logic
const contextMenu = document.getElementById('tab-context-menu');
const copyQueryItem = document.getElementById('ctx-copy-query');
let contextMenuTargetTabId = null;

document.addEventListener('contextmenu', (e) => {
    const tabElement = e.target.closest('.tab');
    if (tabElement) {
        e.preventDefault();
        contextMenuTargetTabId = tabElement.dataset.tabId;

        // Position menu
        const menuWidth = 150;
        let x = e.pageX;
        let y = e.pageY;

        // Boundary check (simple)
        if (x + menuWidth > window.innerWidth) {
            x -= menuWidth;
        }

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.classList.add('visible');
    } else {
        contextMenu.classList.remove('visible');
    }
});

// Helper to hide menu
function hideContextMenu() {
    contextMenu.classList.remove('visible');
    contextMenuTargetTabId = null;
}

const inputs = { close: document.getElementById('ctx-close'), closeOthers: document.getElementById('ctx-close-others'), closeAll: document.getElementById('ctx-close-all') };

if (copyQueryItem) {
    copyQueryItem.addEventListener('click', () => {
        if (contextMenuTargetTabId) {
            const tab = tabs.get(contextMenuTargetTabId);
            if (tab && tab.query) {
                navigator.clipboard.writeText(tab.query).then(() => {
                    // Visual feedback like existing copyRows
                    vscode.postMessage({ command: 'alert', text: '✅ Query copied to clipboard' });
                });
            }
        }
        hideContextMenu();
    });
}

if (inputs.close) {
    inputs.close.addEventListener('click', () => {
        if (contextMenuTargetTabId) {
            closeTab(contextMenuTargetTabId);
        }
        hideContextMenu();
    });
}

if (inputs.closeOthers) {
    inputs.closeOthers.addEventListener('click', () => {
        if (contextMenuTargetTabId) {
            const allIds = Array.from(tabs.keys());
            allIds.forEach(id => {
                if (id !== contextMenuTargetTabId) {
                    closeTab(id);
                }
            });
        }
        hideContextMenu();
    });
}

if (inputs.closeAll) {
    inputs.closeAll.addEventListener('click', () => {
        const allIds = Array.from(tabs.keys());
        allIds.forEach(id => closeTab(id));
        hideContextMenu();
    });
}


// Global Click Listener to Deselect Grid and Hide Context Menu
// Global Click Listener to Deselect Grid and Hide Context Menu
document.addEventListener('mousedown', (event) => {
    // Hide context menu on any click if not clicking inside it
    if (contextMenu && contextMenu.classList.contains('visible')) {
        const isContextMenu = event.target.closest('.context-menu');
        if (!isContextMenu) {
            contextMenu.classList.remove('visible');
        }
    }

    // Check if click is inside any grid or tab list or controls
    const isGrid = event.target.closest('.results-grid');
    const isTab = event.target.closest('.tab');
    const isControl = event.target.closest('.controls');
    const isContextMenu = event.target.closest('.context-menu');

    let shouldDeselect = false;

    if (!isGrid && !isTab && !isControl && !isContextMenu) {
        shouldDeselect = true;
    } else if (isGrid) {
        // If clicking inside grid but NOT on a cell/row/header/scroll, it's empty space -> Deselect
        const isCell = event.target.closest('.ag-cell');
        const isRow = event.target.closest('.ag-row');
        const isHeader = event.target.closest('.ag-header');
        // Scrollbars are tricky, clicking them usually shouldn't clear selection?
        // But if they are native, event.target might be viewport.
        // Let's assume hitting "ag-body-viewport" directly is empty space.

        if (!isCell && !isRow && !isHeader) {
            // Check if scrollbar? Often target is viewport.
            shouldDeselect = true;
        }
    }

    if (shouldDeselect) {
        // Deselect all visible grids
        tabs.forEach(tab => {
            if (tab.api) {
                tab.api.deselectAll();
                tab.api.clearFocusedCell();

                // Clear custom range selection if active
                if (rangeSelection.active && rangeSelection.tabId === tab.id) {
                    rangeSelection.clear();
                    tab.api.refreshCells({ force: true });
                }
            }
        });
    }
});

// New Tab Button (Removed)
// newTabButton.addEventListener('click', () => {
//     vscode.postMessage({ command: 'createNewTab' });
// });

// --- Tab Management ---

function createTab(tabId, query, title, sourceFileUri, preserveFocus, index) {
    if (tabs.has(tabId)) {
        // If it exists, just activate it
        activateTab(tabId);
        return;
    }

    // Hide empty message
    if (noTabsMessage) noTabsMessage.style.display = 'none';

    // Create Tab Element (Header)
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.id = 'tab-' + tabId;
    tabElement.setAttribute('role', 'tab');
    tabElement.setAttribute('aria-selected', 'false');
    tabElement.setAttribute('aria-controls', 'content-' + tabId);
    tabElement.setAttribute('tabindex', '0');
    tabElement.dataset.tabId = tabId;
    tabElement.dataset.sourceFileUri = sourceFileUri || '';

    // Keyboard support
    tabElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activateTab(tabId);
        }
    });

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = title || 'New Query';
    label.title = query || ''; // Tooltip
    tabElement.appendChild(label);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.setAttribute('aria-label', 'Close tab');
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(tabId);
    };
    tabElement.appendChild(closeBtn);

    tabElement.onclick = () => activateTab(tabId);

    // Append new tabs to the end (standard behavior), unless index is provided
    if (typeof index === 'number' && index >= 0 && index < tabList.children.length) {
        tabList.insertBefore(tabElement, tabList.children[index]);
    } else {
        tabList.appendChild(tabElement);
    }

    // Create Content Element
    const contentElement = document.createElement('div');
    contentElement.className = 'tab-content';
    contentElement.id = `content-${tabId}`;
    contentElement.setAttribute('role', 'tabpanel');
    contentElement.setAttribute('aria-labelledby', 'tab-' + tabId);

    // Structural Wrapper: Main Interaction Area + Loading Overlay
    contentElement.innerHTML = `
        <div class="tab-main-content" id="main-${tabId}"></div>
        <div class="custom-loading-overlay" id="overlay-${tabId}" style="display:none;" role="dialog" aria-modal="true" aria-label="Loading"></div>
    `;

    tabContentContainer.appendChild(contentElement);

    // Store tab reference
    tabs.set(tabId, {
        id: tabId,
        element: tabElement,
        content: contentElement,
        mainContent: contentElement.querySelector(`#main-${tabId}`),
        overlay: contentElement.querySelector(`#overlay-${tabId}`),
        gridOptions: null, // Will be init when results arrive
        query: query,
        title: title,
        sourceFileUri: sourceFileUri
    });

    // Automatically activate the new tab
    activateTab(tabId);
}

function activateTab(tabId) {
    if (activeTabId === tabId) return;

    // Deactivate current
    if (activeTabId) {
        const curr = tabs.get(activeTabId);
        if (curr) {
            curr.element.classList.remove('active');
            curr.content.classList.remove('active');
            curr.element.setAttribute('aria-selected', 'false');
        }
    }

    // Activate new
    activeTabId = tabId;
    const next = tabs.get(tabId);
    if (next) {
        next.element.classList.add('active');
        next.content.classList.add('active');
        next.element.setAttribute('aria-selected', 'true');


        // Track last active for this file
        if (next.sourceFileUri) {
            lastActiveTabByFile.set(next.sourceFileUri, tabId);
        }

        // Notify extension of user selection
        vscode.postMessage({ command: 'tabSelected', tabId: tabId });
    }
}

function closeTab(tabId) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    // Remove elements
    tab.element.remove();
    tab.content.remove();
    tabs.delete(tabId);

    // Notify extension
    vscode.postMessage({ command: 'tabClosed', tabId: tabId });

    // Switch to another tab if active was closed
    if (activeTabId === tabId) {
        activeTabId = null;
        if (tabs.size > 0) {
            // Find last VISIBLE tab to activate
            const allIds = Array.from(tabs.keys());
            let nextId = null;
            for (let i = allIds.length - 1; i >= 0; i--) {
                const t = tabs.get(allIds[i]);
                if (t.element.style.display !== 'none') {
                    nextId = t.id;
                    break;
                }
            }

            if (nextId) {
                activateTab(nextId);
            } else {
                // No visible tabs left (even if hidden ones exist)
                if (noTabsMessage) noTabsMessage.style.display = 'flex';
                // Clear any lingering active content just in case
                Array.from(tabContentContainer.children).forEach(child => {
                    if (child.id !== 'no-tabs-message') child.classList.remove('active');
                });
            }
        } else {
            // No tabs left at all
            if (noTabsMessage) noTabsMessage.style.display = 'flex';
            Array.from(tabContentContainer.children).forEach(child => {
                if (child.id !== 'no-tabs-message') {
                    child.classList.remove('active');
                }
            });
        }
    } else {
        // If we closed a background tab, and only 0 remain (unlikely if active != tabId, but possible if logic drifts)
        if (tabs.size === 0) {
            if (noTabsMessage) noTabsMessage.style.display = 'flex';
        }
    }
}

function closeOtherTabs() {
    for (const id of tabs.keys()) {
        if (id !== activeTabId) closeTab(id);
    }
}

function closeAllTabs() {
    for (const id of tabs.keys()) {
        closeTab(id);
    }
}

// Cancel Query Handler (exposed to window for onclick)
window.cancelQuery = function (tabId) {
    vscode.postMessage({ command: 'cancelQuery', tabId: tabId });
};

// --- Custom Set Filter (Community Edition Implementation) ---
class CustomSetFilter {
    init(params) {
        this.params = params;
        this.filterText = null;
        this.uniqueId = Math.random().toString(36).substring(7); // Unique ID to prevent selector collisions
        this.setupGui(params);
    }

    // Setup the UI
    setupGui(params) {
        this.gui = document.createElement('div');
        this.gui.className = 'custom-set-filter';
        const idPrefix = `csf-${this.uniqueId}`;

        this.gui.innerHTML = `
            <div class="custom-set-filter-search">
                <input type="text" placeholder="Search..." aria-label="Filter values" id="${idPrefix}-search">
            </div>
            <div class="custom-set-filter-select-all" style="padding: 4px 8px; border-bottom: 1px solid var(--vscode-dropdown-border);">
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="${idPrefix}-select-all"> 
                    <span style="margin-left: 4px; font-style: italic;">(Select All)</span>
                </label>
            </div>
            <div class="custom-set-filter-list" id="${idPrefix}-list"></div>
            <div class="custom-set-filter-actions">
                <button id="${idPrefix}-apply" class="primary">Apply</button>
                <button id="${idPrefix}-clear">Clear</button>
            </div>
        `;

        this.eFilterText = this.gui.querySelector(`#${idPrefix}-search`);
        this.eSelectAll = this.gui.querySelector(`#${idPrefix}-select-all`);
        this.eFilterList = this.gui.querySelector(`#${idPrefix}-list`);
        this.btnApply = this.gui.querySelector(`#${idPrefix}-apply`);
        this.btnClear = this.gui.querySelector(`#${idPrefix}-clear`);

        // Extract unique values
        this.uniqueValues = new Set();
        this.params.api.forEachNode(node => {
            // Robust value extraction: Try valueGetter, then field access
            let value = null;
            if (this.params.valueGetter) {
                value = this.params.valueGetter(node);
            }
            if ((value === null || value === undefined) && node.data && this.params.colDef.field) {
                value = node.data[this.params.colDef.field];
            }

            // Handle null/undef/objects
            let valStr = '(Blanks)';
            if (value !== null && value !== undefined) {
                valStr = String(value);
            }
            this.uniqueValues.add(valStr);
        });

        // Convert to array and sort
        this.sortedValues = Array.from(this.uniqueValues).sort();

        // State: filtering selected values
        this.selectedValues = new Set(this.sortedValues);

        this.renderList();

        // Event Listeners
        this.eFilterText.addEventListener('input', this.onSearchInput.bind(this));

        this.eSelectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const filterTerm = this.eFilterText.value.toLowerCase();

            this.sortedValues.forEach(value => {
                // Only affect visible items
                if (value.toLowerCase().indexOf(filterTerm) >= 0) {
                    if (isChecked) {
                        this.selectedValues.add(value);
                    } else {
                        this.selectedValues.delete(value);
                    }
                }
            });
            this.renderList();
        });

        this.btnApply.addEventListener('click', () => {
            if (this.params.filterChangedCallback) {
                this.params.filterChangedCallback();
            }
        });

        this.btnClear.addEventListener('click', () => {
            // Select all
            this.sortedValues.forEach(v => this.selectedValues.add(v));
            this.eFilterText.value = '';
            this.renderList();
            if (this.params.filterChangedCallback) {
                this.params.filterChangedCallback();
            }
        });
    }

    renderList() {
        this.eFilterList.innerHTML = '';
        const filterTerm = this.eFilterText.value.toLowerCase();

        let visibleCount = 0;
        let selectedVisibleCount = 0;

        this.sortedValues.forEach(value => {
            if (value.toLowerCase().indexOf(filterTerm) >= 0) {
                visibleCount++;
                const isSelected = this.selectedValues.has(value);
                if (isSelected) selectedVisibleCount++;

                const item = document.createElement('div');
                item.className = 'custom-set-filter-item';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = isSelected;
                checkbox.value = value;

                // Toggle selection
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.selectedValues.add(value);
                    } else {
                        this.selectedValues.delete(value);
                    }
                    // Update Select All state without full re-render
                    this.updateSelectAllState();
                });

                const label = document.createElement('span');
                label.textContent = value;
                label.onclick = () => checkbox.click(); // Click label to toggle

                item.appendChild(checkbox);
                item.appendChild(label);
                this.eFilterList.appendChild(item);
            }
        });

        // Update Select All Checkbox State
        this.eSelectAll.checked = visibleCount > 0 && selectedVisibleCount === visibleCount;
        this.eSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleCount;
    }

    updateSelectAllState() {
        const filterTerm = this.eFilterText.value.toLowerCase();
        let visibleCount = 0;
        let selectedVisibleCount = 0;

        this.sortedValues.forEach(value => {
            if (value.toLowerCase().indexOf(filterTerm) >= 0) {
                visibleCount++;
                if (this.selectedValues.has(value)) {
                    selectedVisibleCount++;
                }
            }
        });

        this.eSelectAll.checked = visibleCount > 0 && selectedVisibleCount === visibleCount;
        this.eSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleCount;
    }

    onSearchInput() {
        this.renderList();
    }

    getGui() {
        return this.gui;
    }

    doesFilterPass(params) {
        // Robust value extraction: Try valueGetter, then field access
        let value = null;
        if (this.params.valueGetter) {
            value = this.params.valueGetter(params.node);
        }
        if ((value === null || value === undefined) && params.node.data && this.params.colDef.field) {
            value = params.node.data[this.params.colDef.field];
        }

        const valStr = (value === null || value === undefined) ? '(Blanks)' : String(value);
        return this.selectedValues.has(valStr);
    }

    isFilterActive() {
        // Active if NOT all values are selected
        return this.selectedValues.size !== this.uniqueValues.size;
    }

    getModel() {
        if (!this.isFilterActive()) {
            return null;
        }
        return { value: Array.from(this.selectedValues) };
    }

    setModel(model) {
        if (model && model.value) {
            this.selectedValues = new Set(model.value);
        } else {
            this.selectedValues = new Set(this.sortedValues); // Reset
        }
        this.renderList();
    }
}

class JsonCellRenderer {
    init(params) {
        this.eGui = document.createElement('div');
        this.eGui.className = 'json-cell';
        this.value = params.value;
        this.updateValue();

        // No specific click listeners needed here, grid handles double click
    }

    getGui() {
        return this.eGui;
    }

    updateValue() {
        if (this.value === null || this.value === undefined) {
            this.eGui.innerHTML = '<span class="null-value">null</span>';
            return;
        }

        let displayValue = '';
        try {
            if (typeof this.value === 'object') {
                const str = JSON.stringify(this.value);
                displayValue = str;
            } else {
                displayValue = String(this.value);
            }
        } catch (e) {
            displayValue = String(this.value);
        }

        // Format nicely: showing first few chars and {...}
        if (displayValue.length > 30) {
            this.eGui.innerHTML = `<span class="json-preview">${escapeHtml(displayValue.substring(0, 30))}...</span> <span class="json-icon">{}</span>`;
            this.eGui.title = "Click to view full JSON";
        } else {
            this.eGui.innerHTML = `<span class="code-value">${escapeHtml(displayValue)}</span>`;
        }
    }

    refresh(params) {
        this.value = params.value;
        this.updateValue();
        return true;
    }
}


class BooleanCellRenderer {
    init(params) {
        this.eGui = document.createElement('span');
        this.value = params.value;
        this.updateValue();
    }

    getGui() {
        return this.eGui;
    }

    updateValue() {
        if (this.value === null || this.value === undefined) {
            this.eGui.className = 'bool-null';
            this.eGui.textContent = 'null';
            return;
        }

        if (this.value === true || String(this.value).toLowerCase() === 'true') {
            this.eGui.className = 'bool-true';
            this.eGui.textContent = 'true';
        } else if (this.value === false || String(this.value).toLowerCase() === 'false') {
            this.eGui.className = 'bool-false';
            this.eGui.textContent = 'false';
        } else {
            // Fallback for weird values
            this.eGui.className = '';
            this.eGui.textContent = String(this.value);
        }
    }

    refresh(params) {
        this.value = params.value;
        this.updateValue();
        return true;
    }
}

// Helper to generate Column Defs
function getColumnDefs(data, tabId) {
    const columnDefs = [];

    // 1. Add Row Selector Column (Blank)
    columnDefs.push({
        headerName: '',
        field: '_rowSelector',
        width: 40,
        minWidth: 40,
        maxWidth: 40,
        pinned: 'left',
        resizable: false,
        sortable: false,
        filter: false,
        suppressMenu: true,
        cellClass: 'row-selector-cell',
        cellRenderer: () => '', // Ensure it is blank
        onCellClicked: (params) => {
            if (params.node) {
                // Selection Logic: Click (Single), Cmd+Click (Toggle), Shift+Click (Range)
                const currentIndex = params.rowIndex;
                const tab = tabs.get(tabId);
                const anchorIndex = (tab && tab.lastClickedRowIndex !== null && tab.lastClickedRowIndex !== undefined)
                    ? tab.lastClickedRowIndex
                    : currentIndex;

                if (params.event.shiftKey) {
                    // Range Selection: Clear others, select range from Anchor to Current
                    params.api.deselectAll();
                    const start = Math.min(anchorIndex, currentIndex);
                    const end = Math.max(anchorIndex, currentIndex);

                    for (let i = start; i <= end; i++) {
                        const rowNode = params.api.getDisplayedRowAtIndex(i);
                        if (rowNode) {
                            rowNode.setSelected(true);
                        }
                    }
                } else if (params.event.metaKey || params.event.ctrlKey) {
                    // Toggle Selection
                    params.node.setSelected(!params.node.isSelected());
                    if (tab) tab.lastClickedRowIndex = currentIndex;
                } else {
                    // Single Select: Clear all, select this one
                    params.api.deselectAll();
                    params.node.setSelected(true);
                    if (tab) tab.lastClickedRowIndex = currentIndex;
                }

                // Focus the cell to ensure keyboard shortcuts (like Copy) work
                if (params.api) {
                    params.api.setFocusedCell(params.rowIndex, '_rowSelector');
                }
            }
        }
    });

    // 2. Add Data Columns
    data.columns.forEach(col => {
        const type = col.type.toLowerCase();
        const isJson = type.includes('json') || type.includes('array') || type.includes('map') || type.includes('struct') || type.includes('row');
        // Simple heuristic for boolean types.
        const isBoolean = type === 'boolean' || type === 'bool' || type === 'tinyint(1)';

        const width = Math.min(Math.max(col.name.length * 9 + 80, 100), 250);

        columnDefs.push({
            field: col.name,
            headerName: col.name,
            sortable: true,
            filter: CustomSetFilter, // Use Custom Set Filter (Community)
            resizable: true,
            width: width,
            headerTooltip: col.type,
            cellRenderer: isBoolean ? BooleanCellRenderer : (isJson ? JsonCellRenderer : undefined),
        });
    });

    return columnDefs;
}

function updateTabWithResults(tabId, data, title) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    if (title) {
        tab.title = title;
        tab.element.querySelector('.tab-label').textContent = title;
    }

    // Hide Overlay
    if (tab.overlay) {
        tab.overlay.style.display = 'none';
        tab.content.setAttribute('aria-busy', 'false');
    }

    // Prepare data
    const columnDefs = getColumnDefs(data, tabId);
    const rowData = data.rows.map(row => {
        const obj = {};
        data.columns.forEach((col, index) => {
            obj[col.name] = row[index];
        });
        return obj;
    });

    tab.columns = data.columns; // Store columns for copy operations

    // REUSE GRID if available
    if (tab.api) {
        // Update Grid Options
        tab.api.setGridOption('columnDefs', columnDefs);
        tab.api.setGridOption('rowData', rowData);

        // Update Toolbar (Replace old controls)
        const oldToolbar = tab.mainContent.querySelector('.controls');
        const newToolbar = createToolbar(tabId, tab.gridOptions, data);
        if (oldToolbar) {
            oldToolbar.replaceWith(newToolbar);
        } else {
            tab.mainContent.prepend(newToolbar);
        }

        // Resize columns to fit if needed, or maintain user width?
        // Usually safer to allow user to keep their widths, but if columns CHANGED, we might want to resize.
        // For now, let's just let AG Grid handle strict column def updates.

        return;
    }

    // FULL REBUILD (First time)
    tab.mainContent.innerHTML = '';

    // Calculate row and header heights based on current density
    let rowH = 35;
    let headH = 42;
    if (currentRowHeightDensity === 'compact') {
        rowH = 28;
        headH = 36;
    } else if (currentRowHeightDensity === 'comfortable') {
        rowH = 45;
        headH = 52;
    }

    const gridOptions = {
        rowData: rowData,
        columnDefs: columnDefs,
        pagination: true,
        paginationPageSize: 100,

        // Row height settings
        rowHeight: rowH,
        headerHeight: headH,

        // Selection Features
        rowSelection: 'multiple',
        suppressRowClickSelection: true,

        // Community Features
        enableCellTextSelection: false, // Disabled to allow custom cell drag selection

        onCellMouseDown: (params) => {
            // Start Drag
            if (params.event.button !== 0) return;
            // Ignore if clicking row selector
            if (params.column.getColId() === '_rowSelector') {
                // Clear any existing range selection to avoid interfering with row copy
                rangeSelection.clear();
                params.api.refreshCells({ force: true });
                return;
            }

            // Clear any native row selections when starting cell drag
            params.api.deselectAll();

            const allCols = params.api.getAllDisplayedColumns();
            const colIdx = allCols.indexOf(params.column);

            rangeSelection.active = true;
            rangeSelection.isDragging = true;
            rangeSelection.tabId = tabId;
            rangeSelection.start = { rowIndex: params.rowIndex, colIndex: colIdx };
            rangeSelection.end = { rowIndex: params.rowIndex, colIndex: colIdx };

            // Attach tabId to api for the global checker
            params.api.tabId = tabId;

            params.api.refreshCells({ force: true });
        },

        onCellMouseOver: (params) => {
            // Update Drag
            if (rangeSelection.isDragging && rangeSelection.tabId === tabId) {
                const allCols = params.api.getAllDisplayedColumns();
                const colIdx = allCols.indexOf(params.column);

                if (rangeSelection.end.rowIndex !== params.rowIndex || rangeSelection.end.colIndex !== colIdx) {
                    rangeSelection.end = { rowIndex: params.rowIndex, colIndex: colIdx };
                    params.api.refreshCells({ force: true });
                }
            }
        },

        ensureDomOrder: true,
        suppressMenuHide: true,

        onCellDoubleClicked: (params) => {
            logToHost('info', `DEBUG: Double click detected on ${params.colDef.headerName}`);
            // Use PER TAB Side Panel
            const currentTab = tabs.get(tabId);
            if (currentTab && currentTab.sidePanel) {
                const headerName = params.colDef.headerName;
                const value = params.value;
                logToHost('info', `DEBUG: Opening side panel for ${headerName}`);
                currentTab.sidePanel.show(headerName, value);
            } else {
                logToHost('error', `DEBUG: sidePanel is undefined or not initialized for tab ${tabId}`);
            }
        },

        defaultColDef: {
            minWidth: 100,
            filter: CustomSetFilter,
            floatingFilter: false,
            cellClassRules: {
                'range-selected-cell': (params) => isRangeSelected(params)
            }
        },

        // Custom Icons
        icons: {
            // Use the Funnel icon for the 'menu' (hamburger) to make it intuitive
            menu: FILTER_ICON_SVG,
            // Hide the secondary filter icon by making it empty (fixes double icon issue)
            filter: ' ',
        }
    };

    // Create Toolbar
    const toolbar = createToolbar(tabId, gridOptions, data);
    tab.mainContent.appendChild(toolbar);

    // Create Split Layout Container
    const splitContainer = document.createElement('div');
    splitContainer.className = 'split-container';
    tab.mainContent.appendChild(splitContainer);

    // Create Grid Container
    const gridDiv = document.createElement('div');
    gridDiv.className = 'ag-theme-quartz results-grid';
    splitContainer.appendChild(gridDiv);

    // Create Side Panel Container (Initially hidden or zero width)
    const sidePanelContainer = document.createElement('div');
    sidePanelContainer.className = 'side-panel-container';
    splitContainer.appendChild(sidePanelContainer);

    // Initialize SidePanel logic specific to this tab
    tab.sidePanel = new SidePanel(tabId);
    sidePanelContainer.appendChild(tab.sidePanel.element);

    if (typeof agGrid !== 'undefined') {
        // Capture API (Works for v31+)
        const api = agGrid.createGrid(gridDiv, gridOptions);
        tab.gridOptions = gridOptions;
        // If createGrid returns undefined (older versions), fall back to gridOptions.api
        tab.api = api || gridOptions.api;

        // Apply current row density settings immediately
        if (currentRowHeightDensity && currentRowHeightDensity !== 'normal') {
            // Re-use logic from updateGridDensity but for single instance
            let rowH = 35;
            let headH = 42;
            if (currentRowHeightDensity === 'compact') {
                rowH = 28;
                headH = 36;
            } else if (currentRowHeightDensity === 'comfortable') {
                rowH = 45;
                headH = 52;
            }

            if (api) {
                if (typeof api.setGridOption === 'function') {
                    api.setGridOption('rowHeight', rowH);
                    api.setGridOption('headerHeight', headH);
                } else {
                    // Fallback
                    if (api.resetRowHeights) api.resetRowHeights();
                    if (api.setHeaderHeight) api.setHeaderHeight(headH);
                }
            }
        }
    } else {
        tab.mainContent.innerHTML = '<div class="error-message">Error: AG Grid library not loaded.</div>';
    }
}

function createToolbar(tabId, gridOptions, data) {
    const toolbar = document.createElement('div');
    toolbar.className = 'controls';

    // Row Count Info (Left Side - Restored for Community)
    // Row Count Info (Left Side - Restored for Community)
    const leftGroup = document.createElement('div');
    const infoText = document.createElement('span');
    infoText.id = 'status-message';
    infoText.textContent = `${data.rows.length} rows`;
    leftGroup.appendChild(infoText);

    if (data.wasTruncated) {
        const warn = document.createElement('span');
        warn.id = 'truncation-warning';
        warn.textContent = 'Truncated';
        warn.title = 'Result set was truncated. Use "Export All" to get full data.';
        warn.className = 'warning-badge';
        warn.style.marginLeft = '8px'; // Add spacing
        leftGroup.appendChild(warn);
    }
    toolbar.appendChild(leftGroup);

    // Action Buttons (Right Side - Restored Copy Buttons)
    const rightGroup = document.createElement('div');
    rightGroup.className = 'button-group';

    // 1. Copy First 5 Rows (TSV)
    if (data.rows.length > 0) {
        const copy5Btn = document.createElement('button');
        copy5Btn.className = 'copy-button';
        const label = 'Copy First 5 Rows';
        copy5Btn.textContent = label;
        copy5Btn.onclick = () => {
            copyToClipboard(data.columns, data.rows.slice(0, 5), true);
            showFeedback(copy5Btn, 'Copied!', label);
        };
        rightGroup.appendChild(copy5Btn);
    }

    // 2. Copy All Cached (TSV)
    if (data.rows.length > 0) {
        const count = data.rows.length;
        const copyAllBtn = document.createElement('button');
        copyAllBtn.className = 'copy-button';
        const label = `Copy ${count}`;
        copyAllBtn.textContent = label;
        copyAllBtn.onclick = () => {
            copyToClipboard(data.columns, data.rows, true);
            showFeedback(copyAllBtn, 'Copied!', label);
        };
        rightGroup.appendChild(copyAllBtn);
    }

    // 3. Export All (Full Query Export)
    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-button';
    exportBtn.textContent = 'Export All';
    exportBtn.title = "Export full results";
    exportBtn.onclick = () => {
        // Trigger extension command to handle full export
        vscode.postMessage({ command: 'exportResults', tabId: tabId });
    };
    rightGroup.appendChild(exportBtn);

    toolbar.appendChild(rightGroup);

    return toolbar;
}

// Helper to copy data
function copyToClipboard(columns, rows, isTsv = true) {
    const delimiter = isTsv ? '\t' : ',';

    // Header
    const headers = columns.map(c => c.name).join(delimiter);

    // Rows
    const body = rows.map(row => {
        return row.map(cell => {
            if (cell === null || cell === undefined) return '';

            let str = '';
            if (typeof cell === 'object') {
                try {
                    str = JSON.stringify(cell);
                } catch (e) {
                    str = String(cell);
                }
            } else {
                str = String(cell);
            }

            if (isTsv) {
                // Remove tabs and newlines for TSV compatibility
                return str.replace(/\t/g, ' ').replace(/\n/g, ' ');
            }

            // For CSV, we'd need more robust escaping, but current usage is mostly TSV copy 
            // or we can reuse similar logic? The existing code didn't do full CSV escaping here.
            // But let's at least keep basic hygiene.
            return str;
        }).join(delimiter);
    }).join('\n');

    const text = headers + '\n' + body;

    navigator.clipboard.writeText(text).then(() => {
        vscode.postMessage({ command: 'alert', text: `✅ Copied ${rows.length} rows to clipboard` });
    });
}


// --- JSON Modal ---

// --- Side Panel Logic ---

// Side Panel Logic - Now Per Tab
class SidePanel {
    constructor(tabId) {
        this.tabId = tabId;
        this.element = document.createElement('div');
        this.element.className = 'side-panel';
        this.element.innerHTML = `
            <div class="side-panel-resizer"></div>
            <div class="side-panel-header">
                <span class="side-panel-title">Details</span>
                <div class="side-panel-actions">
                    <button class="side-panel-button" title="Copy Content" aria-label="Copy Content" id="sp-copy">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4H12V13H4V4ZM3 4C3 3.44772 3.44772 3 4 3H12C12.5523 3 13 3.44772 13 4V13C13 13.5523 12.5523 14 12 14H4C3.44772 14 3 13.5523 3 13V4Z"/><path d="M4 1H12V2H4V1Z"/></svg>
                    </button>
                    <button class="side-panel-button" title="Close" aria-label="Close Side Panel" id="sp-close">✕</button>
                </div>
            </div>
            <div class="side-panel-content" id="sp-content"></div>
        `;
        // Do NOT append to body. It will be appended to side-panel-container in createTab.

        this.contentEl = this.element.querySelector('#sp-content');
        this.titleEl = this.element.querySelector('.side-panel-title');
        this.resizer = this.element.querySelector('.side-panel-resizer');

        this.isResizing = false;
        // Default width stored, but applied to container
        this.currentWidth = 400;

        this.attachListeners();
    }

    attachListeners() {
        // Close
        this.element.querySelector('#sp-close').onclick = () => this.hide();

        // Copy
        const copyBtn = this.element.querySelector('#sp-copy');
        copyBtn.onclick = () => {
            const text = this.contentEl.innerText;
            navigator.clipboard.writeText(text).then(() => {
                vscode.postMessage({ command: 'alert', text: '✅ Content copied to clipboard' });
                // Visual feedback
                const checkIcon = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"/></svg>`;
                const copyIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4H12V13H4V4ZM3 4C3 3.44772 3.44772 3 4 3H12C12.5523 3 13 3.44772 13 4V13C13 13.5523 12.5523 14 12 14H4C3.44772 14 3 13.5523 3 13V4Z"/><path d="M4 1H12V2H4V1Z"/></svg>`;
                showFeedback(copyBtn, checkIcon, copyIcon);
            });
        };

        // Resize
        this.resizer.addEventListener('mousedown', (e) => {
            this.isResizing = true;
            this.resizer.classList.add('resizing');

            // Capture initial X to calculate delta
            this.startX = e.clientX;
            // Get current width of the PARENT container
            const container = this.element.parentElement;
            if (container) {
                this.startWidth = container.offsetWidth;
            } else {
                this.startWidth = this.currentWidth;
            }

            document.addEventListener('mousemove', this.onMouseMove);
            document.addEventListener('mouseup', this.onMouseUp);
            e.preventDefault(); // Prevent text selection
        });

        this.onMouseMove = (e) => {
            if (!this.isResizing) return;

            // Delta: Moving LEFT (negative) increases width. Moving RIGHT (positive) decreases width.
            const delta = this.startX - e.clientX;
            const newWidth = this.startWidth + delta;

            const container = this.element.parentElement;
            if (container) {
                // Max width: 80% of window (prevent locking yourself out)
                const maxW = document.body.clientWidth * 0.8;
                // Min width: 200px
                if (newWidth > 200 && newWidth < maxW) {
                    this.currentWidth = newWidth;
                    container.style.width = `${newWidth}px`;
                }
            }
        };

        this.onMouseUp = () => {
            this.isResizing = false;
            this.resizer.classList.remove('resizing');
            document.removeEventListener('mousemove', this.onMouseMove);
            document.removeEventListener('mouseup', this.onMouseUp);
        };
    }

    show(title, content) {
        // 1. Get Tab
        const tab = tabs.get(this.tabId);
        if (!tab) return;

        // 2. Get Container
        const container = tab.content.querySelector('.side-panel-container');
        if (!container) return;

        // 3. Ensure Element is in container (should be appended at creation, but check)
        if (this.element.parentElement !== container) {
            container.appendChild(this.element);
        }

        // 4. Set Content
        this.titleEl.textContent = title || 'Details';

        let displayStr = '';
        try {
            if (content === null || content === undefined) {
                displayStr = 'null';
            } else if (typeof content === 'string') {
                // Try to parse if it looks like JSON
                const trimmed = content.trim();
                if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
                    try {
                        const parsed = JSON.parse(content);
                        displayStr = JSON.stringify(parsed, null, 2);
                    } catch (e) {
                        displayStr = content; // Parse failed, show raw
                    }
                } else {
                    displayStr = content;
                }
            } else {
                displayStr = JSON.stringify(content, null, 2);
            }
        } catch (e) {
            displayStr = String(content);
        }

        this.contentEl.textContent = displayStr;

        // 5. Set Initial Width if hidden
        const splitContainer = container.parentElement;
        if (splitContainer) {
            const availableWidth = splitContainer.clientWidth;
            if (container.style.display === 'none' || !container.style.display) {
                this.currentWidth = Math.floor(availableWidth * 0.2);
                this.currentWidth = Math.max(250, this.currentWidth);
            }
        }

        container.style.width = `${this.currentWidth}px`;
        container.style.display = 'flex';

        // Resize Grid
        if (tab.api) {
            setTimeout(() => {
                tab.api.sizeColumnsToFit();
            }, 50);
        }
    }

    hide() {
        const container = this.element.parentElement;
        if (container) {
            container.style.display = 'none';
            if (this.tabId) {
                const tab = tabs.get(this.tabId);
                if (tab && tab.api) {
                    setTimeout(() => {
                        tab.api.sizeColumnsToFit();
                    }, 50);
                }
            }
        }
    }
}




function updateTabWithError(tabId, error, query, title) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    if (title) {
        tab.title = title;
        tab.element.querySelector('.tab-label').textContent = title;
    }

    // Hide overlay
    if (tab.overlay) {
        tab.overlay.style.display = 'none';
        tab.content.setAttribute('aria-busy', 'false');
    }

    // Reset formatted content
    tab.mainContent.innerHTML = `
        <div class="error-container">
            <h3>Query Failed</h3>
            <p class="error-message">${escapeHtml(error.message)}</p>
            ${error.details ? `<pre class="error-details">${escapeHtml(error.details)}</pre>` : ''}
        </div>
    `;

    // Clear API reference since grid is gone
    tab.api = null;
    tab.gridOptions = null;
    tab.sidePanel = null;
}

function handleQueryCancelled(tabId, message) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    // Hide Overlay
    if (tab.overlay) {
        tab.overlay.style.display = 'none';
        tab.overlay.innerHTML = ''; // Clean up spinner
    }

    // Show Error/Cancelled State in Tab
    // We can reuse updateTabWithError or create a specific UI state
    // For now, let's treat it as an error but with specific styling if needed
    updateTabWithError(tabId, { message: message || 'Query Cancelled' }, tab.query, tab.title);
}

function showLoading(tabId, query, title, preserveFocus) {
    const tab = tabs.get(tabId);
    if (!tab) {
        // If tab doesn't exist yet, create it
        createTab(tabId, query, title);
        // createTab already sets up structure but doesn't show loading overlay by default in new logic
        // so we need to recursively call showLoading or just fall through if we refactor createTab
        // BUT createTab calls activateTab, etc.
        // Let's just recurse once safely.
        const newTab = tabs.get(tabId);
        if (newTab) showLoading(tabId, query, title);
        return;
    }

    // Force activation logic
    activateTab(tabId);

    // Show Overlay with Loading Content
    if (tab.overlay) {
        tab.overlay.innerHTML = `
            <div class="loading-container">
                <div class="spinner"></div>
                
                <div class="loading-text" role="status" aria-live="polite">Running query...</div>
                <button class="cancel-button" id="cancel-${tabId}">Cancel Query</button>
                <div class="query-preview"><pre>${escapeHtml(query || '')}</pre></div>
            </div>
        `;
        tab.overlay.style.display = 'flex';
        tab.content.setAttribute('aria-busy', 'true');


        // Attach listener programmatically
        const cancelBtn = tab.overlay.querySelector(`#cancel-${tabId}`);
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                logToHost('info', `Cancel button clicked for tab ${tabId}`);
                vscode.postMessage({ command: 'cancelQuery', tabId: tabId });
            });
        }
    } else {
        // Fallback for some reason?
        logToHost('error', `Tab ${tabId} missing overlay element.`);
    }
}



function handleReuseOrCreate(tabId, query, title, sourceFileUri, preserveFocus) {
    const targetId = tabId || activeTabId;

    if (targetId && tabs.has(targetId)) {
        showLoading(targetId, query, title, preserveFocus);
    } else if (targetId) {
        createTab(targetId, query, title, sourceFileUri, preserveFocus);
        showLoading(targetId, query, title, preserveFocus);
    }
}

function filterTabsByFile(fileUri, fileName) {
    if (!fileUri) {
        let potentialFile = null;
        if (activeTabId) {
            const t = tabs.get(activeTabId);
            if (t && t.sourceFileUri) {
                potentialFile = t.sourceFileUri.split('/').pop();
            }
        }

        if (potentialFile && activeFileIndicator) {
            const displayName = potentialFile === 'scratchpad' || potentialFile === 'sql-preview:scratchpad' ? 'Scratchpad' : potentialFile;
            activeFileIndicator.textContent = `${displayName} : Active`;
            activeFileIndicator.style.display = 'inline-block';
            activeFileIndicator.classList.add('persisted');
        }
        return;
    }

    if (activeFileIndicator) {
        if (fileName) {
            const displayName = fileName === 'scratchpad' || fileName === 'sql-preview:scratchpad' ? 'Scratchpad' : fileName;
            activeFileIndicator.textContent = `${displayName} : Active`;
            activeFileIndicator.style.display = 'inline-block';
            activeFileIndicator.classList.remove('persisted');
        } else {
            activeFileIndicator.style.display = 'none';
        }
    }

    let firstVisibleId = null;
    let activeTabVisible = false;

    tabs.forEach(tab => {
        const visible = fileUri && (tab.sourceFileUri === fileUri);
        tab.element.style.display = visible ? 'flex' : 'none';
        if (visible) {
            if (!firstVisibleId) firstVisibleId = tab.id;
            if (activeTabId === tab.id) activeTabVisible = true;
        }
    });

    if (activeTabId && !activeTabVisible) {
        const curr = tabs.get(activeTabId);
        if (curr) {
            curr.element.classList.remove('active');
            curr.content.classList.remove('active');
        }

        // Try to restore last active tab for this file
        const lastActive = lastActiveTabByFile.get(fileUri);
        if (lastActive && tabs.has(lastActive) && tabs.get(lastActive).element.style.display !== 'none') {
            activateTab(lastActive);
        } else if (firstVisibleId) {
            activateTab(firstVisibleId);
        } else {
            activeTabId = null;
        }
    } else if (!activeTabId && firstVisibleId) {
        // No active tab at all (maybe startup), select first visible
        const lastActive = lastActiveTabByFile.get(fileUri);
        if (lastActive && tabs.has(lastActive) && tabs.get(lastActive).element.style.display !== 'none') {
            activateTab(lastActive);
        } else {
            activateTab(firstVisibleId);
        }
    }

    if (noTabsMessage) {
        const anyVisible = firstVisibleId !== null;
        noTabsMessage.style.display = anyVisible ? 'none' : 'flex';

        if (!anyVisible) {
            Array.from(tabContentContainer.children).forEach(child => {
                if (child.id !== 'no-tabs-message') {
                    child.classList.remove('active');
                }
            });
        }
    }
}

// Utils
function showFeedback(element, successContent, originalContent, duration = 2000) {
    if (element.dataset.feedbackActive) return;
    element.dataset.feedbackActive = 'true';

    const isHtml = successContent.trim().startsWith('<');
    if (isHtml) {
        element.innerHTML = successContent;
    } else {
        element.textContent = successContent;
    }

    element.classList.add('feedback-success');

    setTimeout(() => {
        if (isHtml) {
            element.innerHTML = originalContent;
        } else {
            element.textContent = originalContent;
        }
        element.classList.remove('feedback-success');
        delete element.dataset.feedbackActive;
    }, duration);
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Signal ready
vscode.postMessage({ command: 'webviewLoaded' });
function updateGridDensity(density) {
    currentRowHeightDensity = density || 'normal';
    let rowH = 35;
    let headH = 42;

    if (currentRowHeightDensity === 'compact') {
        rowH = 28;
        headH = 36;
    } else if (currentRowHeightDensity === 'comfortable') {
        rowH = 45;
        headH = 52;
    }

    for (const tab of tabs.values()) {
        const api = tab.api || (tab.gridOptions && tab.gridOptions.api); // Use stored API or fallback
        if (api) {
            // Update properties on gridOptions primarily for reference
            if (tab.gridOptions) {
                tab.gridOptions.rowHeight = rowH;
                tab.gridOptions.headerHeight = headH;
            }

            // Use API methods to enforce changes
            // Try setGridOption (v31+)
            if (typeof api.setGridOption === 'function') {
                api.setGridOption('rowHeight', rowH);
                api.setGridOption('headerHeight', headH);
            }
            // Fallback or explicit methods
            if (typeof api.resetRowHeights === 'function') {
                api.resetRowHeights();
            }
            if (typeof api.setHeaderHeight === 'function') {
                api.setHeaderHeight(headH);

            }
        }

    }
}

// --- Connection Manager Logic ---
// --- View Management ---

const mainView = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');

const connectionsButton = document.getElementById('connections-button'); // Gear Icon
const closeSettingsBtn = document.getElementById('close-settings');

// Settings Form Elements
const saveSettingsBtn = document.getElementById('save-settings-btn');
const copyMcpConfigBtn = document.getElementById('copy-mcp-config');
const setPasswordBtn = document.getElementById('set-password-btn');
const clearPasswordBtn = document.getElementById('clear-password-btn');

// Navigation Logic

// 1. Open Settings (Main -> Settings)
if (connectionsButton) {
    connectionsButton.addEventListener('click', () => {
        mainView.style.display = 'none';
        settingsView.style.display = 'flex';
        // Request latest settings
        vscode.postMessage({ command: 'refreshSettings' });
    });
}

// 2. Close Settings (Settings -> Main)
if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsView.style.display = 'none';
        mainView.style.display = 'flex';
    });
}

// Settings Logic
// Auto-Save Logic
function saveAllSettings() {
    const settings = {
        maxRowsToDisplay: parseInt(document.getElementById('cfg-maxRowsToDisplay').value, 10),
        fontSize: parseInt(document.getElementById('cfg-fontSize').value, 10),
        rowHeight: document.getElementById('cfg-rowHeight').value,
        tabNaming: document.getElementById('cfg-tabNaming').value,
        tabNaming: document.getElementById('cfg-tabNaming').value,
        // booleanFormatting removed

        // Connector Settings
        defaultConnector: document.getElementById('cfg-defaultConnector').value,
        databasePath: document.getElementById('cfg-databasePath').value,

        // Trino Settings
        host: document.getElementById('cfg-host').value,
        port: parseInt(document.getElementById('cfg-port').value, 10),
        user: document.getElementById('cfg-user').value,
        catalog: document.getElementById('cfg-catalog').value,
        schema: document.getElementById('cfg-schema').value,
        ssl: document.getElementById('cfg-ssl').checked,
        sslVerify: document.getElementById('cfg-sslVerify').checked,

        // Experimental
        mcpEnabled: document.getElementById('cfg-mcpEnabled')?.checked || false
    };

    vscode.postMessage({ command: 'saveSettings', settings });

    // Immediate UI updates
    if (settings.rowHeight && typeof updateGridDensity === 'function') {
        updateGridDensity(settings.rowHeight);
        // Also update the global variable so new tabs inherit it
        currentRowHeightDensity = settings.rowHeight;
    }
    if (settings.fontSize) {
        document.documentElement.style.setProperty('--sql-preview-font-size', `${settings.fontSize} px`); // Custom var?
        // Check if message handler uses --vscode-editor-font-size
        // Previous code used --sql-preview-font-size here, but message handler used --vscode-editor-font-size?
        // I should stick to one. The 'updateFontSize' handler uses --vscode-editor-font-size.
    }

}

// Attach listeners to all config inputs
const configInputs = document.querySelectorAll('input[id^="cfg-"], select[id^="cfg-"]');
configInputs.forEach(input => {
    input.addEventListener('change', saveAllSettings);
});

// Specific listener for connector toggle
const connectorSelect = document.getElementById('cfg-defaultConnector');
if (connectorSelect) {
    connectorSelect.addEventListener('change', updateConnectorVisibility);
}

if (copyMcpConfigBtn) {
    copyMcpConfigBtn.addEventListener('click', () => {
        const snippet = document.getElementById('mcp-snippet').textContent;
        navigator.clipboard.writeText(snippet).then(() => {
            // Visual feedback
            const originalText = copyMcpConfigBtn.textContent;
            copyMcpConfigBtn.textContent = '✅';
            vscode.postMessage({ command: 'alert', text: '✅ MCP Config copied to clipboard' });

            setTimeout(() => {
                copyMcpConfigBtn.textContent = originalText;
            }, 2000);
        });
    });
}

if (setPasswordBtn) {
    setPasswordBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'setPassword' });
    });
}

if (clearPasswordBtn) {
    clearPasswordBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'clearPassword' });
    });
}

// Test Connection Logic
const testConnectionBtn = document.getElementById('test-connection-btn');
const testConnectionStatus = document.getElementById('test-connection-status');

if (testConnectionBtn) {
    testConnectionBtn.addEventListener('click', () => {
        // Collect current UI values
        const config = {
            host: document.getElementById('cfg-host').value,
            port: parseInt(document.getElementById('cfg-port').value, 10),
            user: document.getElementById('cfg-user').value,
            catalog: document.getElementById('cfg-catalog').value,
            schema: document.getElementById('cfg-schema').value,
            ssl: document.getElementById('cfg-ssl').checked,
            sslVerify: document.getElementById('cfg-sslVerify').checked,
            databasePath: document.getElementById('cfg-databasePath').value,
            defaultConnector: document.getElementById('cfg-defaultConnector').value
        };

        testConnectionBtn.textContent = 'Testing...';
        testConnectionBtn.disabled = true;
        testConnectionStatus.textContent = '';
        testConnectionStatus.className = 'status-badge';

        vscode.postMessage({ command: 'testConnection', config });
    });
}

function updateConnectionList(connections) {
    // Placeholder: This function handles UI updates for saved connections
    // Currently no specific list element is implemented in the settings panel
    console.log('[Webview] Received updated connections:', connections);
}

// Test MCP Logic
const testMcpBtn = document.getElementById('test-mcp-btn');
const testMcpStatus = document.getElementById('test-mcp-status');

if (testMcpBtn) {
    testMcpBtn.addEventListener('click', () => {
        const isEnabled = document.getElementById('cfg-mcpEnabled').checked;
        if (!isEnabled) {
            testMcpStatus.textContent = 'Warning: MCP Server is disabled. Enable it above to test.';
            testMcpStatus.className = 'status-badge';
            testMcpStatus.style.color = 'var(--vscode-charts-yellow)';
            return;
        }

        testMcpBtn.textContent = 'Testing...';
        testMcpBtn.disabled = true;
        testMcpStatus.textContent = '';
        testMcpStatus.className = 'status-badge';

        vscode.postMessage({ command: 'testMcpServer' });
    });
}

// Handle Incoming Settings & Test Results
window.addEventListener('message', event => {
    const message = event.data;
    const command = message.type || message.command;
    switch (command) {
        case 'updateConfig':
            populateSettings(message.config);
            break;
        case 'testConnectionResult':
            if (testConnectionBtn) {
                testConnectionBtn.disabled = false;
                testConnectionBtn.textContent = 'Test Connection';
            }
            if (message.success) {
                testConnectionStatus.textContent = 'Success!';
                testConnectionStatus.className = 'status-badge success';
                testConnectionStatus.style.color = 'var(--vscode-charts-green)';
            } else {
                testConnectionStatus.textContent = 'Failed: ' + message.error;
                testConnectionStatus.className = 'status-badge error';
                testConnectionStatus.style.color = 'var(--vscode-errorForeground)';
            }
            break;
        case 'testMcpResult':
            if (testMcpBtn) {
                testMcpBtn.disabled = false;
                testMcpBtn.textContent = 'Test MCP Server';
            }
            if (message.success) {
                testMcpStatus.textContent = 'Success! ' + (message.message || '');
                testMcpStatus.className = 'status-badge success';
                testMcpStatus.style.color = 'var(--vscode-charts-green)';
            } else {
                testMcpStatus.textContent = 'Failed: ' + (message.error || message.message || 'Unknown error');
                testMcpStatus.className = 'status-badge error';
                testMcpStatus.style.color = 'var(--vscode-errorForeground)';
            }
            break;
    }
});

function populateSettings(config) {
    // User Prefs
    document.getElementById('cfg-maxRowsToDisplay').value = config.maxRowsToDisplay || 500;
    document.getElementById('cfg-fontSize').value = config.fontSize || 0;
    document.getElementById('cfg-rowHeight').value = config.rowHeight || 'normal';
    document.getElementById('cfg-tabNaming').value = config.tabNaming || 'file-sequential';


    // Connector
    document.getElementById('cfg-defaultConnector').value = config.defaultConnector || 'trino';
    document.getElementById('cfg-databasePath').value = config.databasePath || '';

    // Trino
    document.getElementById('cfg-host').value = config.host || '';
    document.getElementById('cfg-port').value = config.port || 8080;
    document.getElementById('cfg-user').value = config.user || '';
    document.getElementById('cfg-catalog').value = config.catalog || '';
    document.getElementById('cfg-schema').value = config.schema || '';
    document.getElementById('cfg-ssl').checked = config.ssl === true;
    document.getElementById('cfg-sslVerify').checked = config.sslVerify !== false; // Default true

    updateConnectorVisibility();

    // Password Status
    const pwdStatus = document.getElementById('password-status');
    if (config.hasPassword) {
        pwdStatus.textContent = '(Password Set)';
        pwdStatus.style.color = 'var(--vscode-charts-green)';
    } else {
        pwdStatus.textContent = '(No Password)';
        pwdStatus.style.color = 'var(--vscode-descriptionForeground)';
    }

    // MCP Server
    document.getElementById('cfg-mcpEnabled').checked = config.mcpEnabled === true;

    // Snippet is now static or updated here if we want to be explicit, but static HTML handles it mostly.
    // Ensure snippet shows the ACTUAL running port (from config.mcpStatus.port)
    const port = config.mcpStatus && config.mcpStatus.port ? config.mcpStatus.port : 8414;

    const snippetEl = document.getElementById('mcp-snippet');
    if (snippetEl) {
        snippetEl.textContent = `{\n    "sql-preview": {\n      "type": "streamable-http",\n      "url": "http://localhost:${port}/mcp"\n    }\n}`;
    }

    const labelEl = document.getElementById('mcp-port-label');
    if (labelEl) {
        labelEl.textContent = port;
    }
}

function updateConnectorVisibility() {
    const connector = document.getElementById('cfg-defaultConnector').value;
    const trinoGroup = document.getElementById('cfg-group-trino');
    const sqliteGroup = document.getElementById('cfg-group-sqlite');

    if (connector === 'sqlite') {
        trinoGroup.style.display = 'none';
        sqliteGroup.style.display = 'block';
    } else {
        trinoGroup.style.display = 'block';
        sqliteGroup.style.display = 'none';
    }
}
// --- Version Info ---
function updateVersionInfo(currentVersion, latestVersion) {
    const versionNumberEl = document.getElementById('version-number');
    const versionStatusEl = document.getElementById('version-status');
    const updateBtn = document.getElementById('update-btn');

    if (versionNumberEl) {
        versionNumberEl.textContent = `v${currentVersion}`;
    }

    if (versionStatusEl && updateBtn) {
        if (!latestVersion) {
            versionStatusEl.textContent = 'Checking for updates...';
            updateBtn.style.display = 'none';
        } else {
            // Compare versions (simple logic, assuming semantic versioning)
            if (latestVersion !== currentVersion) {
                versionStatusEl.textContent = `Latest: v${latestVersion}`;
                versionStatusEl.style.color = 'var(--vscode-textLink-foreground)';
                versionStatusEl.style.cursor = 'pointer';
                versionStatusEl.onclick = () => {
                    vscode.postMessage({ command: 'openExtensionPage' });
                };

                updateBtn.style.display = 'inline-block';
                updateBtn.textContent = 'Update';
                updateBtn.onclick = () => {
                    vscode.postMessage({ command: 'openExtensionPage' });
                };
            } else {
                versionStatusEl.textContent = 'Latest version installed';
                versionStatusEl.style.color = 'var(--vscode-descriptionForeground)';
                updateBtn.style.display = 'none';
            }
        }
    }
}
