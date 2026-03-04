import React, { useEffect } from 'react';

interface ErrorToastProps {
    message: string | null;
    onDismiss: () => void;
    autoDismissMs?: number;
}

export const ErrorToast: React.FC<ErrorToastProps> = ({
    message,
    onDismiss,
    autoDismissMs = 8000
}) => {
    useEffect(() => {
        if (message && autoDismissMs > 0) {
            const timer = setTimeout(onDismiss, autoDismissMs);
            return () => clearTimeout(timer);
        }
    }, [message, autoDismissMs, onDismiss]);

    if (!message) return null;

    return (
        <div className="error-toast" role="alert">
            <div style={{ fontSize: '18px' }}>⚠️</div>
            <div style={{ flex: 1, fontSize: '14px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {message}
            </div>
            <button className="error-toast-close" onClick={onDismiss} aria-label="Close error message">
                &times;
            </button>
        </div>
    );
};
