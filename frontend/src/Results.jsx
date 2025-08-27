import React, { useMemo } from 'react';
import DownloadTableRows from "./TranscriptionFilesTable.jsx";
import LogFilesDownload from "./LogFilesDownload.jsx";
import DownloadLink from "./DownloadLink.jsx";

const Results = ({ results }) => {
    // useMemo ensures this check only runs once per component render.
    const isFirefox = useMemo(() => {
        // Check if window.navigator is available to prevent errors during server-side rendering (SSR).
        if (typeof window !== 'undefined' && window.navigator) {
            return window.navigator.userAgent.toLowerCase().includes('firefox');
        }
        return false;
    }, []);

    // Separate the log files, grouped files, and the zip file
    const { logFiles, groupedFiles, groupedFilesMergedFormat, zipFile } = results.reduce((acc, result) => {
        const fileName = result.file_name;
        if (fileName === 'transcribe.log' || fileName === 'transcriber_output.txt') {
            acc.logFiles.push(result);
        } else if (fileName === 'files.zip') {
            acc.zipFile = result;
        } else {
            const key = fileName.split('.')[0];
            if (key.endsWith('_merged')) {
                if (!acc.groupedFilesMergedFormat[key]) {
                    acc.groupedFilesMergedFormat[key] = [];
                }
                acc.groupedFilesMergedFormat[key].push(result);
            } else {
                if (!acc.groupedFiles[key]) {
                    acc.groupedFiles[key] = [];
                }
                acc.groupedFiles[key].push(result);
            }
        }
        return acc;
    }, { logFiles: [], groupedFiles: {}, groupedFilesMergedFormat: {},zipFile: null });

    // Calculate the maximum number of files in any group
    const maxFilesInGroup = Math.max(...Object.values(groupedFiles).map(group => group.length), 0);

    return (
        <div style={{marginBottom: '5%'}}>
            <h2>Transcribed files</h2>
            <p>
                The download of transcriptions is possible as a single file or
                as a zip-file containing all transcribed files.
            </p>
            <div>
                {zipFile && (
                    <div>
                        <h3>Zip file</h3>
                        <div>
                            <p>The zip file contains all the transcribed files for easy download.</p>
                            <DownloadLink
                                linkText={"Download zip file."}
                                isFirefox={isFirefox}
                                downloadUrl={"http://localhost:8001" + zipFile.file_url}
                            />
                        </div>
                    </div>
                )}
                <h3>Standard files</h3>
                <table>
                    <thead>
                    <tr>
                        <th>File</th>
                        <th colSpan={maxFilesInGroup}>Extensions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <DownloadTableRows
                        groupedFiles={groupedFiles}
                        classNameForStyling={"file-name"}
                        isFirefox={isFirefox}
                    />
                    </tbody>
                </table>
                <h3>Merged speaker format</h3>
                <table>
                    <thead>
                    <tr>
                        <th>File</th>
                        <th colSpan={maxFilesInGroup}>Extensions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <DownloadTableRows
                        groupedFiles={groupedFilesMergedFormat}
                        classNameForStyling={"file-name-merged"}
                        isFirefox={isFirefox}
                    />
                    </tbody>
                </table>
            </div>
            <div>
                <h3>Log files</h3>
                <p>
                    The log files contain output from the transcription process and from the application running
                    the transcription.
                    <br/> If something goes wrong these files can help determine the issue.
                </p>
                <LogFilesDownload
                    logFiles={logFiles}
                    isFirefox={isFirefox}
                />
            </div>
        </div>
    );
};

export default Results;