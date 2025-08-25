import React from 'react';

/**
 * A component that renders a list of links to download log files,
 * with special handling for Firefox to prevent WebSocket disconnections.
 *
 */
const LogFilesDownload = ({ logFiles, isFirefox }) => {
    // Render a special version for Firefox that uses a hidden iframe as a target.
    // This downloads the file without the main page interpreting it as navigation.
    if (isFirefox) {
        return (
            <>
                {logFiles.map((result, index) => {
                    const iframeId = `logDownloadIframe-${index}`;
                    return (
                        <div key={index}>
                            <iframe id={iframeId} name={iframeId} style={{ display: "none" }} title="Download helper" />
                            <a href={"http://localhost:8001" + result.file_url}
                               target={iframeId}
                               download>
                                {result.file_name}
                            </a>
                        </div>
                    );
                })}
            </>
        );
    }

    // Standard rendering for other browsers
    return (
        <>
            {logFiles.map((result, index) => (
                <div key={index}>
                    <a href={"http://localhost:8001" + result.file_url} rel="noreferrer" download>
                        {result.file_name}
                    </a>
                </div>
            ))}
        </>
    );
};

export default LogFilesDownload;

