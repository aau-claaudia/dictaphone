import React, { useState, useEffect } from 'react';

const TranscriptionStatus = ({ key, startTime, size }) => {
    const [duration, setDuration] = useState(Date.now() - startTime);

    useEffect(() => {
        // Immediately update the duration when startTime changes to prevent showing stale data from a previous section.
        setDuration(Date.now() - startTime);
        // Set up an interval to update the duration every second.
        const intervalId = setInterval(() => {
            setDuration(Date.now() - startTime);
        }, 1000);

        // The cleanup function returned by useEffect will run when the component unmounts.
        return () => {
            clearInterval(intervalId);
        };
    }, [startTime]);

    const formatDuration = (duration) => {
        // Convert duration from milliseconds to seconds
        const totalSeconds = Math.floor(duration / 1000);

        // Calculate minutes and seconds
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        // Format the result
        return `${minutes} minute(s) and ${seconds} second(s)`;
    }

    const getDataText = (dataSize, duration) => {
        let dataText = "";
        if (dataSize > 1000000000) {
            dataText = (dataSize / 1000000000).toFixed(2) + " GB";
        } else {
            dataText = (dataSize / 1000000).toFixed(2) + " MB";
        }
        let text = "Transcribing " + dataText + " of data. The transcription time on a GPU can be roughly estimated to 1 minute pr. 1 MB of data. ";
        text += "Total duration of the transcription so far is: " + formatDuration(duration);
        return text;
    }

    const getPercentageDone = (duration, dataSize) => {
        let expectedDurationSeconds = Math.floor(dataSize / 1000000 * 60)
        let durationSeconds = Math.floor(duration / 1000)
        let percentage = durationSeconds / expectedDurationSeconds;
        // never return more than 90 %, will confuse the user
        return percentage < 0.9 ? percentage : 0.9;
    }

    return (
        <div style={{marginBottom: '5%'}}>
            <h2> Transcription status </h2>
            <p> {getDataText(size, duration)} </p>
            <h3>Estimated progress based on data size</h3>
            <progress className="progress-bar" value={getPercentageDone(duration, size)}/>
        </div>
    );
};

export default TranscriptionStatus;