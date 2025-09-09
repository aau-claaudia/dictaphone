import React from 'react';

/**
 * A component that renders table rows for downloadable files, with special
 * handling for Firefox to prevent WebSocket disconnections.
 *
 */
const TranscriptionFilesTable = ({ groupedFiles, isFirefox, maxFilesInGroup, fileNameStyle }) => {
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
    const renderFileLink = (result, index, subIndex) => {
        const fileExtension = getFileExtension(result.file_name);
        const title = getTitleForFileExtension(fileExtension);

        if (isFirefox) {
            const iframeId = `downloadIframe-${index}-${subIndex}`;
            return (
                <>
                    <iframe id={iframeId} name={iframeId} style={{ display: "none" }} title="Download helper" />
                    <a href={result.file_url}
                       title={title}
                       target={iframeId}
                       className="button"
                       download>
                        {fileExtension}
                    </a>
                </>
            );
        }

        return (
            <a href={result.file_url}
               title={title}
               rel="noreferrer"
               className="button"
               download>
                {fileExtension}
            </a>
        );
    };
    return (
        <div className="transcription-files-container">
            {/* Desktop Table View */}
            <table className="transcription-files-table">
                <thead>
                <tr>
                    <th>File</th>
                    <th colSpan={maxFilesInGroup}>Extensions</th>
                </tr>
                </thead>
                <tbody>
                {Object.keys(groupedFiles).map((key, index) => (
                    <tr key={index}>
                        <td className={fileNameStyle} title={key}>{key}</td>
                        {groupedFiles[key].map((result, subIndex) => (
                            <td key={subIndex}>
                                {renderFileLink(result, index, subIndex)}
                            </td>
                        ))}
                    </tr>
                ))}
                </tbody>
            </table>

            {/* Mobile Card View */}
            <div className="transcription-files-list">
                {Object.keys(groupedFiles).map((key, index) => (
                    <div key={index} className="file-card">
                        <div className="file-card-name" title={key}>{key}</div>
                        <div className="file-card-links">
                            {groupedFiles[key].map((result, subIndex) => (
                                <div key={subIndex}>
                                    {renderFileLink(result, index, subIndex)}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

            export default TranscriptionFilesTable;
