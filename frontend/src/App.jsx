import React, {useCallback, useEffect, useRef, useState} from "react";
import {csrfToken} from "./csrf.js";
import { MediaRecorder, register } from 'extendable-media-recorder';
import { connect } from 'extendable-media-recorder-wav-encoder';
import Settings from "./Settings.jsx";

await register(await connect());

const App = () => {
    const [recording, setRecording] = useState(false);
    const recordingRef = useRef(recording);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [mediaStream, setMediaStream] = useState(null);
    const [intervalId, setIntervalId] = useState(null);
    const intervalIdRef = useRef(intervalId);
    const [requestIds, setRequestIds] = useState([]); // Store request Ids
    const requestIdsRef = useRef(requestIds);
    const [transcriptions, setTranscriptions] = useState([]); // Store transcriptions
    const [showSettings, setShowSettings] = useState(false);
    const [silenceThreshold, setSilenceThreshold] = useState(-30);
    const [chunkSize, setChunkSize] = useState(10000);

    // Keep the ref updated with the latest requestIds object
    useEffect(() => {
        requestIdsRef.current = requestIds;
    }, [requestIds]);
    useEffect(() => {
        recordingRef.current = recording;
    }, [recording]);
    useEffect(() => {
        intervalIdRef.current = intervalId;
    }, [intervalId]);

    //TODO: load relevant state from session / backend server

    const startRecording = async () => {
        // TODO: make threshold and duration configurable (at least for testing - maybe configurable for advanced users)
        const silenceThreshold = 0.30; // Define the silence threshold (normalized amplitude)
        const silenceDuration = 1700; // Duration (in ms) to consider as a pause
        let silenceStart = null;
        let isRecording = false;

        // Request access to the microphone
        const streamInstance = await navigator.mediaDevices.getUserMedia({
            audio: {
                noiseSuppression: false,
                echoCancellation: false
            }
        });
        setMediaStream(streamInstance);
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(streamInstance);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const mediaRecorderInstance = new MediaRecorder(streamInstance,{ mimeType: 'audio/wav' });
        setMediaRecorder(mediaRecorderInstance);
        let audioChunks = [];

        mediaRecorderInstance.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorderInstance.onstop = async () => {
            console.debug("Audio chunk captured, size of array: ", audioChunks.length);
            // Process or save the audio chunks here
            if (audioChunks.length > 0) {
                const body = new Blob(audioChunks, { type: "audio/wav" })
                // Prepare the form data
                const formData = new FormData();
                formData.append("audio_chunk", body, "chunk.wav");

                //TODO: use relative links and proxy
                try {
                    const response = await fetch("http://localhost:8000/upload-audio-chunk/", {
                        method: "POST",
                        credentials: 'include', // Include cookies
                        headers: {
                            'X-CSRFToken': csrfToken, // Include the CSRF token
                        },
                        body: formData,
                    });
                    if (response.ok) {
                        const queueRequestData = await response.json();
                        console.debug(queueRequestData);
                        // Add the request ID to the state
                        setRequestIds((prevIds) => [...prevIds, queueRequestData.request_id]);
                    }
                    audioChunks = [];
                } catch (e) {
                    // Handle network errors
                    console.debug("Error sending audio data to backend: " + e);
                }
            }
        };

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function checkAudioLevel() {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
            //console.debug("Average: " + average);
            const normalizedLevel = average / 255; // Normalize to a range of 0 to 1
            //console.debug("Normalized level: " + normalizedLevel)
            if (normalizedLevel < silenceThreshold) {
                // Silence detected
                if (!silenceStart) {
                    silenceStart = Date.now();
                    console.debug("Silence start: " + silenceStart);
                } else if (((Date.now() - silenceStart) > silenceDuration) && isRecording) {
                    // Stop recording if silence lasts long enough
                    //console.debug("Datetime: " + Date.now());
                    console.debug("Time elapsed: " + (Date.now() - silenceStart));
                    console.debug("Silence detected, stopping recording...");
                    mediaRecorderInstance.stop();
                    isRecording = false;
                }
            } else {
                // Sound detected
                //silenceStart = null;
                if (silenceStart !== null) {
                    console.debug("Sound detected, resetting silenceStart.");
                    silenceStart = null;
                }
                if (!isRecording) {
                    console.debug("Sound detected, starting recording...");
                    mediaRecorderInstance.start();
                    isRecording = true;
                }
            }
            requestAnimationFrame(checkAudioLevel);
        }
        checkAudioLevel();
        setRecording(true);
        console.debug("Scheduling poll function.");
        let id = setInterval(pollTranscriptions, 5000);
        console.debug("Interval id from setInterval: " + id);
        setIntervalId(id);
    }

    const stopRecording = () => {
        console.debug("Stopping the recording...");
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop(); // Stop the MediaRecorder
        } else {
            console.debug("MediaRecorder is not active or already stopped.");
        }
        setRecording(false);
        console.debug("Stopping the stream...");
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
    };

    const stopPoll = () => {
        if (intervalIdRef.current && Number.isInteger(intervalIdRef.current)) {
            console.debug("Stopping the poll function.")
            clearInterval(intervalIdRef.current);
        } else {
            console.log("The interval id is not defined.");
        }
    }
    useEffect(() => {
        console.log("use effect triggered...")
        console.log(requestIds)
        // if there are no requestId's to poll and we are not recording then unschedule the poll function
        if (requestIds.length === 0 && !recordingRef.current ) {
            stopPoll();
        }
    }, [requestIds, intervalId]);

    const removeRequestId = (requestIdToRemove) => {
        // Convert requestIdToRemove to an integer
        const idToRemove = parseInt(requestIdToRemove, 10);
        setRequestIds((prevRequestIds) => {
            const updatedRequestIds = prevRequestIds.filter(reqId => reqId !== idToRemove);
            console.debug("Request ids after remove: " + updatedRequestIds);
            return updatedRequestIds;
        });
    };

    // Function to poll the server for transcription texts
    const pollTranscriptions = () => {
        // TODO: implement functionality to ensure the transcription text chunks are shown in correct order (use requestId -> increasing number)
        console.debug("Running poll method with requestIds: " + requestIdsRef.current)
        if (requestIdsRef.current.length > 0) {
            const requestIdJson = [];
            const formData = new FormData();
            for (const requestId of requestIdsRef.current) {
                requestIdJson.push({
                    "request_id": requestId
                })
            }
            formData.append('request_ids', JSON.stringify(requestIdJson))
            console.debug("Generated request id JSON: " + requestIdJson)

            fetch(`http://localhost:8000/get-transcriptions/`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "X-CSRFToken": csrfToken,
                },
                body: formData,
            })
                .then(response => response.json())
                .then(data => {
                    // debug logging the data returned from the server
                    console.debug('Response data: ', data.transcriptions);
                    if (data.transcriptions) {
                        for (const transcription of data.transcriptions) {
                            if (transcription && transcription.transcription_text) {
                                if (transcription.transcription_text === "SILENT_AUDIO_CHUNK") {
                                    // the audio was detected as silent in the backend
                                    console.debug("Silent audio chunk for requestId: " + transcription.request_id);
                                } else if (transcription.transcription_confidence && isBelowConfidenceThreshold(transcription.transcription_confidence)) {
                                    // the confidence is too low and most likely hallucination
                                    console.debug("Hallucination detected in audio chunk.")
                                    if (transcription.transcription_file_name) {
                                        let text = "Inaudible sound - file name: " + transcription.transcription_file_name;
                                        setTranscriptions((prev) => [...prev, text]);
                                    }
                                } else {
                                    // the transcription text is okay
                                    console.debug("Setting transcription text for requestId: " + transcription.request_id);
                                    setTranscriptions((prev) => [...prev, transcription.transcription_text]);
                                }
                                // Remove the request ID from the polling list
                                removeRequestId(transcription.request_id)
                            } else {
                                console.debug("Transcription text not ready for requestId: " + transcription.request_id)
                            }
                        }
                    }
                })
                .catch(error => {
                    console.error('Error polling backend:', error);
                });
        } else {
            console.debug("No request ids to send.")
            if (!recordingRef.current) {
                console.debug("Not recording, stopping the poll function.")
                stopPoll();
            }
        }
    };

    const isParsableAsFloat = (value) => {
        return !isNaN(parseFloat(value)) && isFinite(value);
    }

    // TODO: make hallucination threshold configurable through settings?
    const isBelowConfidenceThreshold = (confidence) => {
        return (isParsableAsFloat(confidence) && (parseFloat(confidence) < 0.55));
    }

    const resetServerData = async () => {
        console.debug("Resetting server data.")
        setTranscriptions([]);
        fetch(`http://localhost:8000/reset-data/`, {
            method: "GET",
            credentials: "include",
            headers: {
                "X-CSRFToken": csrfToken,
            },
        })
            .catch(error => {
                console.error('Error resetting server data:', error);
            });
    }

    // Function for showing or hiding the settings
    const showOrHideSettings = () => {
        setShowSettings(!showSettings);
    }

    const onUpdateSilenceThreshold = async (threshold) => {
        console.debug("Updating the silence threshold, sending data: " + threshold)
        // Prepare the form data
        const formData = new FormData();
        formData.append("silence_threshold", threshold);
        try {
            const response = await fetch("http://localhost:8000/update-silence-threshold/", {
                method: "POST",
                credentials: 'include', // Include cookies
                headers: {
                    'X-CSRFToken': csrfToken, // Include the CSRF token
                },
                body: formData,
            });
            if (response.ok) {
                const responseData = await response.json();
                console.debug(responseData);
            }
        } catch (e) {
            // Handle network errors
            console.debug("Error updating silence threshold: " + e);
        }
        setSilenceThreshold(parseInt(threshold, 10));
    }

    const onUpdateChunkSize = async (chunksize) => {
        setChunkSize(parseInt(chunksize, 10));
    }

    return (
        <div className='App'>
            <h1>Dictaphone prototype</h1>
            <button onClick={startRecording} disabled={recording}>
                Start Recording
            </button>
            <button onClick={stopRecording} disabled={!recording}>
                Stop Recording
            </button>
            <button onClick={resetServerData}>
                Reset server data
            </button>
            <button onClick={showOrHideSettings}>
                {showSettings ? 'Hide settings' : 'Show settings'}
            </button>
            {
                showSettings && (
                    <Settings
                        onUpdateSilenceThreshold={onUpdateSilenceThreshold}
                        currentSilenceThreshold={silenceThreshold}
                        onUpdateChunkSize={onUpdateChunkSize}
                        currentChunkSize={chunkSize}
                    />
                )
            }
            <h2>Transcribed text</h2>
            <textarea
                id="transcribed-text"
                readOnly
                value={transcriptions.join("\n")}
                style={{width: "100%", height: "200px", marginTop: "20px"}}
            />
        </div>
    );
};

export default App;