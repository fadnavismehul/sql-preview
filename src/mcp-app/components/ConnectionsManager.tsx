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
        <div className={`connections-manager ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>Connections</h2>
                {!isAdding && (
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={fetchData} disabled={isLoading}>Refresh</button>
                        <button onClick={() => setIsAdding(true)} style={{ fontWeight: 'bold' }}>Add Connection</button>
                    </div>
                )}
            </div>

            {testResult && (
                <div style={{ margin: '15px 0', padding: '10px', backgroundColor: testResult.includes('failed') || testResult.includes('Error') ? '#fee2e2' : '#dcfce7', color: '#111', borderRadius: '4px', border: '1px solid currentColor' }}>
                    <strong>Notice:</strong> {testResult}
                    <button onClick={() => setTestResult(null)} style={{ marginLeft: '10px', float: 'right' }}>Clear</button>
                </div>
            )}

            {isAdding ? (
                <div style={{ marginTop: '20px', border: '1px solid var(--border-color, #ccc)', padding: '20px', borderRadius: '8px' }}>
                    <h3>Create New Connection</h3>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Database Type</label>
                        <select
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                            style={{ padding: '8px', minWidth: '200px' }}
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
                <div style={{ marginTop: '20px' }}>
                    {isLoading ? <p>Loading...</p> : connections.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', backgroundColor: 'var(--surface-color, #f9f9f9)', borderRadius: '8px' }}>
                            <p>No connections configured yet.</p>
                            <button onClick={() => setIsAdding(true)} style={{ marginTop: '10px' }}>Add your first connection</button>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border-color, #ccc)' }}>
                                    <th style={{ padding: '10px' }}>Name</th>
                                    <th style={{ padding: '10px' }}>Type</th>
                                    <th style={{ padding: '10px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {connections.map(c => (
                                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border-color, #eee)' }}>
                                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{c.name}</td>
                                        <td style={{ padding: '10px' }}>{c.type}</td>
                                        <td style={{ padding: '10px', display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleTestExisting(c)}>Test</button>
                                            <button onClick={() => handleDeleteConnection(c.id, c.name)} style={{ color: 'var(--error-color, #dc2626)' }}>Delete</button>
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
