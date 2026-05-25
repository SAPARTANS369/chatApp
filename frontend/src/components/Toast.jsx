import React, { useState, useCallback } from 'react';

let toastId = 0;

export const useToast = () => {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'success') => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    }, []);

    const ToastContainer = () => (
        <div className="toast-container">
            {toasts.map(t => (
                <div key={t.id} className={`toast ${t.type !== 'success' ? t.type : ''}`}>
                    <span className="toast-icon">
                        {t.type === 'error' ? '[ERR]' : t.type === 'warning' ? '[WARN]' : '[OK]'}
                    </span>
                    {t.message}
                </div>
            ))}
        </div>
    );

    return { addToast, ToastContainer };
};
