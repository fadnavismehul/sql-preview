
import React, { useEffect, useState } from 'react';
// import { useMcpApp } from '../hooks/useMcpApp'; // Removed
import { App } from '@modelcontextprotocol/ext-apps';

interface ConnectionProfile {
    id: string;
    name: string;
    type: string;
    host?: string;
    user?: string;
    port?: number;
    catalog?: string;
    schema?: string;
    ssl?: boolean;
}

interface Props {
    app: App | null;
    theme: string;
}

export const ConnectionsManager: React.FC<Props> = ({ app, theme }) => {
    // const { app } = useMcpApp(); // Removed
    const [connections, setConnections] = useState<ConnectionProfile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);

    const fetchConnections = async () => {
        if (!app) return;
        setIsLoading(true);
        try {
            const result = await app.callServerTool({ name: 'list_connections', arguments: {} });
            if (result.content && result.content[0] && result.content[0].text) {
                const list = JSON.parse(result.content[0].text);
                setConnections(list);
            }
        } catch (e) {
            console.error('Failed to fetch connections:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchConnections();
    }, [app]);

    const handleTestConnection = async (profile: ConnectionProfile) => {
        if (!app) return;
        setTestResult(`Testing ${profile.name}...`);
        try {
            const result = await app.callServerTool({
                name: 'test_connection',
                arguments: { connectionId: profile.id }
            });
            console.log('Test Result:', result);
            if (result.content && result.content[0]) {
                setTestResult(result.content[0].text);
            } else {
                setTestResult('No response content');
            }
        } catch (e) {
            setTestResult(`Error: ${e}`);
        }
    };

    return (
        <div className={`connections-manager ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ padding: '20px' }}>
            <h2>Connections</h2>
            <button onClick={fetchConnections} disabled={isLoading}>Refresh</button>
            <div style={{ marginTop: '20px' }}>
                {isLoading ? <p>Loading...</p> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Host</th>
                                <th>User</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {connections.map(c => (
                                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '8px' }}>{c.name}</td>
                                    <td style={{ padding: '8px' }}>{c.type}</td>
                                    <td style={{ padding: '8px' }}>{c.host}</td>
                                    <td style={{ padding: '8px' }}>{c.user}</td>
                                    <td style={{ padding: '8px' }}>
                                        <button onClick={() => handleTestConnection(c)}>Test</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            {testResult && (
                <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ccc', background: theme === 'dark' ? '#333' : '#f9f9f9' }}>
                    <strong>Test Result:</strong> {testResult}
                    <button onClick={() => setTestResult(null)} style={{ marginLeft: '10px' }}>Clear</button>
                </div>
            )}
        </div>
    );
};
