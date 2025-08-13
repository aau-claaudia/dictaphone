import React from 'react';
import './Overlay.css';

const ErrorOverlay = ({ error, onRefresh }) => {
    if (!error) {
        return null;
    }

    return (
        <div className="error-overlay">
            <div className="error-modal">
                <h2>An Error Occurred</h2>
                <p>
                    We're sorry, but the application encountered a problem.
                </p>
                <div className="error-details">
                    <strong>Details:</strong> {error.message}
                </div>
                <p>Please try refreshing the page to resolve the issue.</p>
                <button onClick={onRefresh} className="refresh-button">
                    Refresh Page
                </button>
            </div>
        </div>
    );
};

export default ErrorOverlay;