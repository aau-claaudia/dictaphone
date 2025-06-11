import React from 'react';

const Settings = ({onUpdateChunkSize, currentChunkSize, onUpdateSilenceThreshold, currentSilenceThreshold}) => {
    // Function to handle model change
    const handleSilenceThresholdChange = (event) => {
        onUpdateSilenceThreshold(event.target.value);
    };

    // Function to handle model change
    const handleChunkSizeChange = (event) => {
        onUpdateChunkSize(event.target.value);
    };

    return (
        <div style={{marginBottom: '5%'}}>
            <h2>Settings</h2>
            <div>
                <h3>Silence Threshold</h3>
                <p>
                    Leading silence in the audio will be trimmed on the server side, and sound chunks with complete silence will be filtered.
                    Set the sensitivity of this trimming/filtering.
                </p>
                <div className="select-box">
                    <select defaultValue={currentSilenceThreshold} onChange={handleSilenceThresholdChange}>
                        <option value="-35">High (less silence filtering)</option>
                        <option value="-30">Normal (recommended)</option>
                        <option value="-25">Low (filter more quite sounds)</option>
                    </select>
                </div>
            </div>
            <hr/>
            <div>
                <h3>Sound recording chunk size (seconds)</h3>
                <p>
                    Audio is recorded in "chunks" and sent to the server for transcription.
                    Set the size (in seconds) of these audio chunks.
                </p>
                <div className="select-box">
                    <select defaultValue={currentChunkSize} onChange={handleChunkSizeChange}>
                        <option value="5000">5</option>
                        <option value="10000">10</option>
                        <option value="15000">15</option>
                    </select>
                </div>
            </div>
            <hr/>
        </div>
    );
};

export default Settings;