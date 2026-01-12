/**
 * Webview Script for SQL Results
 * Handles the display of query results using AG Grid.
 */

// Initialize VS Code API
// We do NOT use persistent state here anymore, ensuring single source of truth in Extension
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
            // We iterate in reverse insertion order naturally if we use Array.from(keys).reverse()
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

function updateTabWithResults(tabId, data, title) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    if (title) {
        tab.title = title;
        tab.element.querySelector('.tab-label').textContent = title;
    }

    // Clear loading/error content
    tab.content.innerHTML = '';

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
        columnDefs: data.columns.map(col => ({
            field: col.name,
            headerName: col.name,
            sortable: true,
            filter: true,
            resizable: true,
            headerTooltip: col.type, // Show type on hover
        })),
        pagination: true,
        paginationPageSize: 100,
        enableCellTextSelection: true,
        ensureDomOrder: true,
        suppressMenuHide: true,
        defaultColDef: {
            minWidth: 100,
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

    // Row Count Info (Left Side Now)
    const leftGroup = document.createElement('div');
    const infoText = document.createElement('span');
    infoText.id = 'status-message';
    infoText.textContent = `${data.rows.length} rows`;

    if (data.wasTruncated) {
        const warn = document.createElement('span');
        warn.id = 'truncation-warning';
        warn.textContent = ' (Truncated)';
        warn.title = 'Result set was truncated. Use "Export All" to get full data.';
        leftGroup.appendChild(warn);
    }
    leftGroup.appendChild(infoText);
    toolbar.appendChild(leftGroup);

    // Action Buttons (Right Side)
    const rightGroup = document.createElement('div');
    rightGroup.className = 'button-group';

    // 1. Copy First 5 Rows (TSV)
    if (data.rows.length > 0) {
        const copy5Btn = document.createElement('button');
        copy5Btn.className = 'copy-button';
        copy5Btn.textContent = 'Copy First 5 Rows';
        copy5Btn.onclick = () => {
            copyToClipboard(data.columns, data.rows.slice(0, 5), true); // true = TSV
        };
        rightGroup.appendChild(copy5Btn);
    }

    // 2. Copy All Cached Rows (TSV)
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
    exportBtn.onclick = () => {
        // Trigger extension command to handle full export
        vscode.postMessage({ command: 'exportResults', tabId: tabId });
    };
    rightGroup.appendChild(exportBtn);

    toolbar.appendChild(rightGroup);

    return toolbar;
}

// Helper to copy data as TSV (default) or CSV
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
        // If tab doesn't exist yet (rare race condition or direct call), create it
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
        </div>
    `;
}



function handleReuseOrCreate(tabId, query, title, sourceFileUri) {
    // Logic: If tabId is provided, force it to be active and show loading.
    // If not provided (legacy?), fallback to activeTabId.

    const targetId = tabId || activeTabId;

    if (targetId && tabs.has(targetId)) {
        showLoading(targetId, query, title);
    } else if (targetId) {
        // Tab doesn't exist? Create/restore it
        createTab(targetId, query, title, sourceFileUri);
        showLoading(targetId, query, title);
    }
}

function filterTabsByFile(fileUri, fileName) {
    // Persistence: If we switch to a non-SQL file (undefined fileUri), 
    // we want to preserve the current state (show last results).
    if (!fileUri) {
        // Optionally, we could try to infer the "active context" from the currently visible tabs
        // and update the indicator to say "Showing results for: [inferred file]"
        // But sticking with "No Active SQL File" or just hiding it is safer to avoid confusion if multiple files' data is somehow mixed (though we prevent that).
        // Actually, if we are preserving view, let's keep the indicator as is?
        // No, let's update it to verify what IS shown.
        let potentialFile = null;
        if (activeTabId) {
            const t = tabs.get(activeTabId);
            if (t && t.sourceFileUri) {
                // Try to extract filename
                potentialFile = t.sourceFileUri.split('/').pop();
            }
        }

        if (potentialFile && activeFileIndicator) {
            const displayName = potentialFile === 'scratchpad' || potentialFile === 'sql-preview:scratchpad' ? 'Scratchpad' : potentialFile;
            activeFileIndicator.textContent = `${displayName} : Active`;
            activeFileIndicator.style.display = 'inline-block';
            activeFileIndicator.classList.add('persisted'); // Add style for persisted state
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

    // Strict Mode: Only show tabs that explicitly match the fileUri.
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

    // If the currently active tab is now hidden, we must switch (visually)
    if (activeTabId && !activeTabVisible) {
        // Deactivate current implicitly (visuals only)
        const curr = tabs.get(activeTabId);
        if (curr) {
            curr.element.classList.remove('active');
            curr.content.classList.remove('active');
        }

        // Switch to the first visible tab for this file
        if (firstVisibleId) {
            activateTab(firstVisibleId);
        } else {
            // No tabs visible for this file? 
            activeTabId = null;
        }
    } else if (!activeTabId && firstVisibleId) {
        // If nothing was active (or just reset), activate first candidate
        activateTab(firstVisibleId);
    }

    // Toggle "No Tabs" message
    if (noTabsMessage) {
        // Should show if NO visible tabs
        const anyVisible = firstVisibleId !== null;
        noTabsMessage.style.display = anyVisible ? 'none' : 'flex';

        if (!anyVisible) {
            // Ensure all content is hidden to prevent ghost data
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