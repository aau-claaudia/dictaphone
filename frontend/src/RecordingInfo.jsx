import React from 'react';

const RecordingInfo = ({ audioUrl, lastSavedTitle, deleteCompleted }) => {

    return (
        <div>
            <h3>{lastSavedTitle ? lastSavedTitle : "Error no title"}</h3>
            {audioUrl && !deleteCompleted && (
                <audio
                    controls
                    src={audioUrl}
                    style={{width: "100%", marginBottom: "5%"}}
                >
                    Your browser does not support the audio element.
                </audio>
            )}
        </div>
    );
};

export default RecordingInfo;
