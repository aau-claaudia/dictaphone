import React from 'react';

/**
 * A component that renders a single download link, with special
 * handling for Firefox to prevent WebSocket disconnections.
 *
 */
const DownloadLink = ({ downloadUrl, isFirefox, linkText}) => {

    // Render a special version for Firefox that uses a hidden iframe as a target.
    if (isFirefox) {
        // Use a unique ID for the iframe to avoid conflicts if multiple links are on the page.
        const iframeId = `singleDownloadIframe-${downloadUrl.replace(/[^a-zA-Z0-9]/g, '')}`;
        return (
            <>
                <iframe id={iframeId} name={iframeId} style={{ display: "none" }} title="Download helper" />
                <a href={downloadUrl} target={iframeId} download>
                    {linkText}
                </a>
            </>
        );
    }

    // Standard rendering for other browsers
    return (
        <a href={downloadUrl} rel="noreferrer" download>
            {linkText}
        </a>
    );
};

export default DownloadLink;

