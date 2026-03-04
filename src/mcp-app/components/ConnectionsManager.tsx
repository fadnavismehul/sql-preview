import React, { useEffect, useState } from 'react';
import { App } from '@modelcontextprotocol/ext-apps';
import { DynamicForm, JsonSchema } from './DynamicForm';

interface ConnectionProfile {
    id: string;
    name: string;
    type: string;
    [key: string]: unknown;
}

interface ConnectorSchemaDef {
    id: string;
    supportsPagination: boolean;
    schema: JsonSchema;
}

interface Props {
    app: App | null;
    theme: string;
}

export const ConnectionsManager: React.FC<Props> = ({ app, theme }) => {
    const [connections, setConnections] = useState<ConnectionProfile[]>([]);
    const [connectors, setConnectors] = useState<ConnectorSchemaDef[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);

    // Form State
    const [isAdding, setIsAdding] = useState(false);
    const [selectedType, setSelectedType] = useState<string>('');

    const fetchData = async () => {
        if (!app) { return; }
        setIsLoading(true);
        try {
            // Fetch saved connections
            const connResult = await app.callServerTool({ name: 'list_connections', arguments: {} });
            if (connResult.content?.[0]?.type === 'text') {
                setConnections(JSON.parse(connResult.content[0].text));
            }

            // Fetch supported connector schemas
            const schemaResult = await app.callServerTool({ name: 'list_connectors', arguments: {} });
            if (schemaResult.content?.[0]?.type === 'text') {
                setConnectors(JSON.parse(schemaResult.content[0].text));
            }
        } catch (e) {
            console.error('Failed to fetch data:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [app]);

    const handleTestExisting = async (profile: ConnectionProfile) => {
        if (!app) { return; }
        setTestResult(`Testing ${profile.name}...`);
        try {
            const result = await app.callServerTool({
                name: 'test_connection',
                arguments: { connectionId: profile.id }
            });
            const text = result.content?.[0]?.type === 'text' ? result.content[0].text : 'No response';
            setTestResult(text);
        } catch (e) {
            setTestResult(`Error: ${e}`);
        }
    };

    const handleTestNewForm = async (formData: Record<string, unknown>) => {
        if (!app || !selectedType) { return; }
        setTestResult(`Testing connection ${formData.name || 'Untitled'}...`);
        try {
            const result = await app.callServerTool({
                name: 'test_connection',
                arguments: {
                    type: selectedType,
                    connectionProfile: formData
                }
            });
            const text = result.content?.[0]?.type === 'text' ? result.content[0].text : 'No response';
            setTestResult(text);
        } catch (e) {
            setTestResult(`Error: ${e}`);
        }
    };

    const handleSaveConnection = async (formData: Record<string, unknown>) => {
        if (!app || !selectedType) { return; }
        setIsLoading(true);
        try {
            const profileToSave = {
                ...formData,
                type: selectedType,
                id: formData.id || `conn_${Date.now()}` // Generate ID if new
            };

            await app.callServerTool({
                name: 'save_connection',
                arguments: { connectionProfile: profileToSave }
            });

            setIsAdding(false);
            setSelectedType('');
            setTestResult('Connection saved successfully!');
            await fetchData(); // Refresh list
        } catch (e) {
            setTestResult(`Error saving: ${e}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteConnection = async (id: string, name: string) => {
        if (!app || !window.confirm(`Are you sure you want to delete '${name}'?`)) { return; }
        setIsLoading(true);
        try {
            await app.callServerTool({ name: 'delete_connection', arguments: { connectionId: id } });
            setTestResult(`Connection '${name}' deleted.`);
            await fetchData();
        } catch (e) {
            setTestResult(`Error deleting: ${e}`);
        } finally {
            setIsLoading(false);
        }
    };

    const activeSchemaDef = connectors.find(c => c.id === selectedType);

    return (
        <div className={`connections-manager ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ padding: 'var(--spacing-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <h2>Connections</h2>
                {!isAdding && (
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                        <button className="btn" onClick={fetchData} disabled={isLoading}>Refresh</button>
                        <button className="btn btn-primary" onClick={() => setIsAdding(true)}>Add Connection</button>
                    </div>
                )}
            </div>

            {testResult && (
                <div style={{ margin: 'var(--spacing-md) 0', padding: 'var(--spacing-sm)', backgroundColor: testResult.includes('failed') || testResult.includes('Error') ? 'var(--color-error-bg)' : 'rgba(34, 197, 94, 0.1)', color: testResult.includes('failed') || testResult.includes('Error') ? 'var(--color-error)' : 'var(--color-success)', borderRadius: 'var(--radius-sm)', border: '1px solid currentColor', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div><strong>Notice:</strong> {testResult}</div>
                    <button className="btn" onClick={() => setTestResult(null)} style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>Clear</button>
                </div>
            )}

            {isAdding ? (
                <div style={{ marginTop: 'var(--spacing-lg)', border: '1px solid var(--color-border)', padding: 'var(--spacing-lg)', borderRadius: 'var(--radius-lg)' }}>
                    <h3>Create New Connection</h3>
                    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <label style={{ fontWeight: '500', display: 'block', marginBottom: 'var(--spacing-xs)' }}>Database Type</label>
                        <select
                            className="form-input"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                            style={{ maxWidth: '300px' }}
                        >
                            <option value="">-- Select Type --</option>
                            {connectors.map(c => (
                                <option key={c.id} value={c.id}>{c.id.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>

                    {activeSchemaDef && activeSchemaDef.schema ? (
                        <DynamicForm
                            schema={{ ...activeSchemaDef.schema, type: 'object' }}
                            onSubmit={handleSaveConnection}
                            onTest={handleTestNewForm}
                            onCancel={() => { setIsAdding(false); setSelectedType(''); }}
                            isSubmitting={isLoading}
                        />
                    ) : selectedType ? (
                        <p style={{ color: 'red' }}>This connector does not define a UI configuration schema yet.</p>
                    ) : null}
                </div>
            ) : (
                <div style={{ marginTop: 'var(--spacing-lg)' }}>
                    {isLoading ? <p>Loading...</p> : connections.length === 0 ? (
                        <div style={{ padding: 'var(--spacing-lg)', textAlign: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)' }}>
                            <p style={{ color: 'var(--color-text-muted)' }}>No connections configured yet.</p>
                            <button className="btn btn-primary" onClick={() => setIsAdding(true)} style={{ marginTop: 'var(--spacing-sm)' }}>Add your first connection</button>
                        </div>
                    ) : (
                        <table className="connections-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                                    <th style={{ padding: 'var(--spacing-sm)' }}>Name</th>
                                    <th style={{ padding: 'var(--spacing-sm)' }}>Type</th>
                                    <th style={{ padding: 'var(--spacing-sm)' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {connections.map(c => (
                                    <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: 'var(--spacing-sm)', fontWeight: '500' }}>{c.name}</td>
                                        <td style={{ padding: 'var(--spacing-sm)', color: 'var(--color-text-muted)' }}>{c.type}</td>
                                        <td style={{ padding: 'var(--spacing-sm)', display: 'flex', gap: 'var(--spacing-sm)' }}>
                                            <button className="btn" onClick={() => handleTestExisting(c)}>Test</button>
                                            <button className="btn btn-danger" onClick={() => handleDeleteConnection(c.id, c.name)}>Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};
