/**
 * Webview Script for SQL Results
 * Handles the display of query results using AG Grid Community (Free).
 */

// Initialize VS Code API
const vscode = acquireVsCodeApi();

// --- State ---
const tabs = new Map(); // Stores gridOptions and data for each tab
let activeTabId = null;

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
            createTab(message.tabId, message.query, message.title, message.sourceFileUri);
            break;
        case 'resultData':
            updateTabWithResults(message.tabId, message.data, message.title);
            break;
        case 'queryError':
            updateTabWithError(message.tabId, message.error, message.query, message.title);
            break;
        case 'showLoading':
            showLoading(message.tabId, message.query, message.title);
            break;
        case 'reuseOrCreateActiveTab':
            handleReuseOrCreate(message.tabId, message.query, message.title, message.sourceFileUri);
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
    }
});

// New Tab Button
newTabButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'createNewTab' });
});

// --- Tab Management ---

function createTab(tabId, query, title, sourceFileUri) {
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
    tabElement.dataset.tabId = tabId;
    tabElement.dataset.sourceFileUri = sourceFileUri || '';

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = title || 'New Query';
    label.title = query || ''; // Tooltip
    tabElement.appendChild(label);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(tabId);
    };
    tabElement.appendChild(closeBtn);

    tabElement.onclick = () => activateTab(tabId);

    tabList.appendChild(tabElement);

    // Create Content Element
    const contentElement = document.createElement('div');
    contentElement.className = 'tab-content';
    contentElement.id = `content-${tabId}`;

    // Initial Loading State
    contentElement.innerHTML = `
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Preparing query...</div>
        ${query ? `<div class="query-preview"><pre>${escapeHtml(query)}</pre></div>` : ''}
        <button class="cancel-button" onclick="cancelQuery('${tabId}')">Cancel Query</button>
    </div>
  `;

    tabContentContainer.appendChild(contentElement);

    // Store tab reference
    tabs.set(tabId, {
        id: tabId,
        element: tabElement,
        content: contentElement,
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
        }
    }

    // Activate new
    activeTabId = tabId;
    const next = tabs.get(tabId);
    if (next) {
        next.element.classList.add('active');
        next.content.classList.add('active');
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

// --- JSON Rendering ---

class JsonCellRenderer {
    init(params) {
        this.eGui = document.createElement('div');
        this.eGui.className = 'json-cell';
        this.value = params.value;
        this.updateValue();

        // Add click handler to button or element
        this.eGui.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent row selection if intended?
            showJsonModal(params.colDef.headerName, this.value);
        });
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

function updateTabWithResults(tabId, data, title) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    if (title) {
        tab.title = title;
        tab.element.querySelector('.tab-label').textContent = title;
    }

    // Clear loading/error content
    tab.content.innerHTML = '';

    // Determine Columns and Renderers
    const columnDefs = data.columns.map(col => {
        const type = col.type.toLowerCase();
        const isJson = type.includes('json') || type.includes('array') || type.includes('map') || type.includes('struct');

        return {
            field: col.name,
            headerName: col.name,
            sortable: true,
            filter: true, // Default Community filter
            resizable: true,
            headerTooltip: col.type,
            cellRenderer: isJson ? JsonCellRenderer : undefined,
            // filterParams removed (Set Filter not supported)
        };
    });

    // Setup AG Grid
    const gridOptions = {
        rowData: data.rows.map(row => {
            // Convert array of values to object {col1: val1, ...} based on columns
            const obj = {};
            data.columns.forEach((col, index) => {
                obj[col.name] = row[index];
            });
            return obj;
        }),
        columnDefs: columnDefs,
        pagination: true,
        paginationPageSize: 100,

        // Community Features
        enableCellTextSelection: true,
        ensureDomOrder: true,
        suppressMenuHide: true,

        defaultColDef: {
            minWidth: 100,
            filter: true, // Standard text filter
            floatingFilter: false, // User requested removal of "bottom filter"
        },

        // Status Bar (Removed Enterprise)

        // Custom Icons
        icons: {
            filter: FILTER_ICON_SVG
        }
    };

    // Create Toolbar
    const toolbar = createToolbar(tabId, gridOptions, data);
    tab.content.appendChild(toolbar);

    // Create Grid Container
    const gridDiv = document.createElement('div');
    gridDiv.className = 'ag-theme-quartz results-grid'; // Added results-grid class
    // gridDiv.style.height = '100%'; // CSS handles this via flex
    // gridDiv.style.width = '100%';
    tab.content.appendChild(gridDiv);

    if (typeof agGrid !== 'undefined') {
        agGrid.createGrid(gridDiv, gridOptions);
        tab.gridOptions = gridOptions;
    } else {
        tab.content.innerHTML = '<div class="error-message">Error: AG Grid library not loaded.</div>';
    }
}

function createToolbar(tabId, gridOptions, data) {
    const toolbar = document.createElement('div');
    toolbar.className = 'controls';

    // Row Count Info (Left Side - Restored for Community)
    const leftGroup = document.createElement('div');
    const infoText = document.createElement('span');
    infoText.id = 'status-message';
    infoText.textContent = `${data.rows.length} rows`;

    if (data.wasTruncated) {
        const warn = document.createElement('span');
        warn.id = 'truncation-warning';
        warn.textContent = ' (Truncated)';
        warn.title = 'Result set was truncated. Use "Export All" to get full data.';
        warn.className = 'warning-badge';
        leftGroup.appendChild(warn);
    }
    leftGroup.appendChild(infoText);
    toolbar.appendChild(leftGroup);

    // Action Buttons (Right Side - Restored Copy Buttons)
    const rightGroup = document.createElement('div');
    rightGroup.className = 'button-group';

    // 1. Copy First 5 Rows (TSV)
    if (data.rows.length > 0) {
        const copy5Btn = document.createElement('button');
        copy5Btn.className = 'copy-button';
        copy5Btn.textContent = 'Copy First 5 Rows';
        copy5Btn.onclick = () => {
            copyToClipboard(data.columns, data.rows.slice(0, 5), true);
        };
        rightGroup.appendChild(copy5Btn);
    }

    // 2. Copy All Cached (TSV)
    if (data.rows.length > 0) {
        const count = data.rows.length;
        const copyAllBtn = document.createElement('button');
        copyAllBtn.className = 'copy-button';
        copyAllBtn.textContent = `Copy ${count}`;
        copyAllBtn.onclick = () => {
            copyToClipboard(data.columns, data.rows, true);
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
            // Escape special chars if necessary (simple version)
            const str = String(cell);
            if (isTsv) {
                return str.replace(/\t/g, ' ').replace(/\n/g, ' ');
            }
            return str;
        }).join(delimiter);
    }).join('\n');

    const text = headers + '\n' + body;

    navigator.clipboard.writeText(text).then(() => {
        vscode.postMessage({ command: 'alert', text: `✅ Copied ${rows.length} rows to clipboard` });
    });
}

// --- JSON Modal ---

function showJsonModal(title, jsonValue) {
    // Check if modal container exists
    let modal = document.getElementById('json-modal-overlay');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'json-modal-overlay';
        modal.className = 'json-modal-overlay';
        modal.innerHTML = `
            <div class="json-modal">
                <div class="json-modal-header">
                    <span class="json-modal-title">JSON View</span>
                    <div class="json-modal-actions">
                        <button class="json-modal-button" id="json-copy-btn">Copy</button>
                        <button class="json-modal-button" id="json-close-btn">Close</button>
                    </div>
                </div>
                <pre class="json-modal-body" id="json-modal-content"></pre>
            </div>
        `;
        document.body.appendChild(modal);

        // Close handlers
        document.getElementById('json-close-btn').onclick = () => { modal.style.display = 'none'; };
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        // Copy handler
        document.getElementById('json-copy-btn').onclick = () => {
            const content = document.getElementById('json-modal-content').innerText;
            navigator.clipboard.writeText(content).then(() => {
                const btn = document.getElementById('json-copy-btn');
                const original = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = original, 1500);
            });
        };
    }

    const contentEl = document.getElementById('json-modal-content');
    const titleEl = modal.querySelector('.json-modal-title');

    titleEl.textContent = title || 'JSON View';

    let displayStr = '';
    try {
        if (typeof jsonValue === 'string') {
            // Try to parse if it's a stringified JSON
            const parsed = JSON.parse(jsonValue);
            displayStr = JSON.stringify(parsed, null, 2);
        } else {
            displayStr = JSON.stringify(jsonValue, null, 2);
        }
    } catch (e) {
        displayStr = String(jsonValue);
    }

    contentEl.textContent = displayStr;
    modal.style.display = 'flex';
}


function updateTabWithError(tabId, error, query, title) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    if (title) {
        tab.title = title;
        tab.element.querySelector('.tab-label').textContent = title;
    }

    tab.content.innerHTML = `
        <div class="error-container">
            <div class="error-icon">✕</div>
            <h3>Query Failed</h3>
            <p class="error-message">${escapeHtml(error.message)}</p>
            ${error.details ? `<pre class="error-details">${escapeHtml(error.details)}</pre>` : ''}
        </div>
    `;
}

function showLoading(tabId, query, title) {
    const tab = tabs.get(tabId);
    if (!tab) {
        // If tab doesn't exist yet, create it
        createTab(tabId, query, title);
        return;
    }

    // Force activation
    activateTab(tabId);

    // Reset content to loading
    tab.content.innerHTML = `
        <div class="loading-container">
            <div class="spinner"></div>
            <div class="loading-text">Running query...</div>
            <div class="query-preview"><pre>${escapeHtml(query || '')}</pre></div>
            <button class="cancel-button" onclick="cancelQuery('${tabId}')">Cancel Query</button>
        </div>
    `;
}



function handleReuseOrCreate(tabId, query, title, sourceFileUri) {
    const targetId = tabId || activeTabId;

    if (targetId && tabs.has(targetId)) {
        showLoading(targetId, query, title);
    } else if (targetId) {
        createTab(targetId, query, title, sourceFileUri);
        showLoading(targetId, query, title);
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

        if (firstVisibleId) {
            activateTab(firstVisibleId);
        } else {
            activeTabId = null;
        }
    } else if (!activeTabId && firstVisibleId) {
        activateTab(firstVisibleId);
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