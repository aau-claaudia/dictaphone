import React from 'react';

const RecordingInfo = ({ audioUrl, lastSavedTitle }) => {

    return (
        <div>
            <h3>{lastSavedTitle}</h3>
            {audioUrl && (
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
