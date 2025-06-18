import React from 'react';

const Settings = ({onUpdateSilenceGao, currentSilenceGap, onUpdateSilenceThreshold, currentSilenceThreshold}) => {
    // Function to handle model change
    const handleSilenceThresholdChange = (event) => {
        onUpdateSilenceThreshold(event.target.value);
    };

    // Function to handle model change
    const handleSilenceGapChange = (event) => {
        onUpdateSilenceGao(event.target.value);
    };

    return (
        <div style={{marginBottom: '5%'}}>
            <h2>Settings</h2>
            <div>
                <h3>Silence Threshold (backend)</h3>
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
                <h3>Silence gap between sound chunks (ms)</h3>
                <p>
                    Audio is recorded in "chunks" and sent to the server for transcription.
                    When silence is detected for the selected amount of time the recorded sound is sent to the server for transcription.
                </p>
                <div className="select-box">
                    <select defaultValue={currentSilenceGap} onChange={handleSilenceGapChange}>
                        <option value="1500">1500</option>
                        <option value="1700">1700 (Recommended)</option>
                        <option value="2000">2000</option>
                    </select>
                </div>
            </div>
            <hr/>
        </div>
    );
};

export default Settings;