import React from 'react';

/**
 * A component that renders table rows for downloadable files, with special
 * handling for Firefox to prevent WebSocket disconnections.
 *
 */
const DownloadTableRows = ({ groupedFiles, classNameForStyling, isFirefox }) => {
    const getFileExtension = (fileName) => {
        const specialCases = ['dote.json'];
        for (const ext of specialCases) {
            if (fileName.endsWith(ext)) {
                return ext;
            }
        }
        return fileName.split('.').pop();
    };

    const extensionToolTip = new Map();
    extensionToolTip.set('aud', 'A subtitle-like format used by INRS-Telecom, a research university in Quebec');
    extensionToolTip.set('csv', 'Comma-separated value format used for spead sheets');
    extensionToolTip.set('docx', 'Word document format');
    extensionToolTip.set('dote.json', 'AAU based JSON transcription format: Distributed Open Transcription Environment');
    extensionToolTip.set('json', 'A JSON output file with maximum details from the transcription algorithm');
    extensionToolTip.set('srt', 'SubRip Subtitle (SRT) is a Popular subtitle format');
    extensionToolTip.set('tsv', 'Tab-separated values (TSV) is a simple, text-based file format for storing tabular data');
    extensionToolTip.set('txt', 'A simple text file format. This format does not contain the speaker data.');
    extensionToolTip.set('vtt', 'A popular subtitle/captioning file format');

    const getTitleForFileExtension = (extension) => {
        return extensionToolTip.get(extension);
    }

    // Render a special version for Firefox that uses a hidden iframe as a target.
    // This downloads the file without the main page interpreting it as navigation.
    if (isFirefox) {
        return (
            <>
                {Object.keys(groupedFiles).map((key, index) => (
                    <tr key={index}>
                        <td className={classNameForStyling} title={key}>{key}</td>
                        {groupedFiles[key].map((result, subIndex) => {
                            // Generate a unique ID for each iframe to prevent conflicts.
                            const iframeId = `downloadIframe-${index}-${subIndex}`;
                            return (
                                <td key={subIndex}>
                                    <iframe id={iframeId} name={iframeId} style={{ display: "none" }} title="Download helper" />
                                    <a href={result.file_url}
                                       title={getTitleForFileExtension(getFileExtension(result.file_name))}
                                       target={iframeId}
                                       className="button"
                                       download>
                                        {getFileExtension(result.file_name)}
                                    </a>
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </>
        );
    }
    // For all other browsers (Chrome, Edge, etc.), the standard `download` attribute works reliably
    // when the server sends the correct 'Content-Disposition' header.
    return (
        <>
            {Object.keys(groupedFiles).map((key, index) => (
                <tr key={index}>
                    <td className={classNameForStyling} title={key}>{key}</td>
                    {groupedFiles[key].map((result, subIndex) => (
                        <td key={subIndex}>
                            <a href={result.file_url}
                               title={getTitleForFileExtension(getFileExtension(result.file_name))}
                               rel="noreferrer"
                               className="button"
                               download>
                                {getFileExtension(result.file_name)}
                            </a>
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
};

export default DownloadTableRows;
