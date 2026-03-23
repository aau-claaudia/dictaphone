import React, {useState} from 'react';

const RecordingSettings = ({onUpdateBoost, currentBoost}) => {
    const [micBoost, setMicBoost] = useState(currentBoost);

    const handleBoostChange = (event) => {
        setMicBoost(Number(event.target.value))
        onUpdateBoost(event.target.value);
    };

    return (
        <div style={{marginBottom: '5%'}}>
            <h2>Settings</h2>
            {/* Section for setting the mic Boost level, amplify the signal x times */}
            <div>
                <h3>Microphone amplification level</h3>
                <div className="select-box">
                    <select value={Number(micBoost)} onChange={handleBoostChange}>
                        <option value="1">1x</option>
                        <option value="2">2x</option>
                        <option value="3">3x</option>
                        <option value="5">5x</option>
                        <option value="10">10x</option>
                        <option value="20">20x</option>
                    </select>
                </div>
            </div>
        </div>
    );
};

export default RecordingSettings;