import React, { useState, useEffect } from 'react';

interface SchemaProperty {
    type: string;
    title?: string;
    description?: string;
    default?: unknown;
    ui?: {
        widget?: string;
    };
}

export interface JsonSchema {
    type: 'object';
    properties: Record<string, SchemaProperty>;
    required?: string[];
}

interface DynamicFormProps {
    schema: JsonSchema;
    initialData?: Record<string, unknown>;
    onSubmit: (data: Record<string, unknown>) => void;
    onTest?: (data: Record<string, unknown>) => void;
    onCancel: () => void;
    isSubmitting?: boolean;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
    schema,
    initialData = {},
    onSubmit,
    onTest,
    onCancel,
    isSubmitting = false
}) => {
    const [formData, setFormData] = useState<Record<string, unknown>>({});

    // Initialize form data with defaults mixed with initialData
    useEffect(() => {
        const initial: Record<string, unknown> = { ...initialData };
        if (schema.properties) {
            Object.entries(schema.properties).forEach(([key, prop]) => {
                if (initial[key] === undefined && prop.default !== undefined) {
                    initial[key] = prop.default;
                }
                // Ensure booleans default to false if not set
                if (prop.type === 'boolean' && initial[key] === undefined) {
                    initial[key] = false;
                }
            });
        }
        setFormData(initial);
    }, [schema, initialData]);

    const handleChange = (key: string, value: unknown) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    const handleTest = () => {
        if (onTest) {
            onTest(formData);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="dynamic-form" style={{ display: 'flex', flexDirection: 'column', gap: '15px', maxWidth: '500px' }}>
            {/* Standard Profile Fields */}
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontWeight: 'bold' }}>Connection Name *</label>
                <input
                    type="text"
                    required
                    value={(formData.name as string) || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="My Production Database"
                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)' }}
                />
            </div>

            {Object.entries(schema.properties || {}).map(([key, prop]) => {
                const isRequired = schema.required?.includes(key);
                const value = formData[key];

                return (
                    <div key={key} className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontWeight: 'bold' }}>
                            {prop.title || key} {isRequired && '*'}
                        </label>
                        {prop.description && (
                            <small style={{ color: 'var(--text-muted-color, #666)' }}>{prop.description}</small>
                        )}

                        {prop.type === 'boolean' ? (
                            <input
                                type="checkbox"
                                checked={!!value}
                                onChange={(e) => handleChange(key, e.target.checked)}
                                style={{ alignSelf: 'flex-start', transform: 'scale(1.2)', margin: '5px 0' }}
                            />
                        ) : prop.type === 'number' ? (
                            <input
                                type="number"
                                required={isRequired}
                                value={value !== undefined ? String(value) : ''}
                                onChange={(e) => handleChange(key, e.target.value !== '' ? Number(e.target.value) : undefined)}
                                style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)' }}
                            />
                        ) : (
                            <input
                                type={prop.ui?.widget === 'password' ? 'password' : 'text'}
                                required={isRequired}
                                value={(value as string) || ''}
                                onChange={(e) => handleChange(key, e.target.value)}
                                style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)' }}
                            />
                        )}
                    </div>
                );
            })}

            <div className="form-actions" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={onCancel} style={{ padding: '8px 16px' }} disabled={isSubmitting}>
                    Cancel
                </button>
                {onTest && (
                    <button type="button" onClick={handleTest} style={{ padding: '8px 16px' }} disabled={isSubmitting}>
                        Test Connection
                    </button>
                )}
                <button type="submit" style={{ padding: '8px 16px', fontWeight: 'bold' }} disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Save Connection'}
                </button>
            </div>
        </form>
    );
};
