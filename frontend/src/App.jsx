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
    const [intervalId, setIntervalId] = useState(null);
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

    //TODO: load relevant state from session / backend server

    // Variable to store the .wav header (first 44 bytes)
    // The header is not automatically added to chunks when using slicing
    let header = null;

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: false,
                    echoCancellation: false
                }
            });
            //const recorder = new MediaRecorder(stream);
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/wav' });

            recorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    let firstChunk = false;
                    const audioChunk = event.data;
                    // Read the first 44 bytes (header) from the first chunk
                    if (!header) {
                        firstChunk = true;
                        const arrayBuffer = await audioChunk.arrayBuffer();
                        header = arrayBuffer.slice(0, 44); // Extract the first 44 bytes
                    }

                    // Prepend the header to subsequent chunks (not for first chunk)
                    const body = !firstChunk
                        ? new Blob([header, audioChunk], { type: "audio/wav" })
                        : audioChunk;

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
                    } catch (e) {
                        // Handle network errors
                        console.debug("Error sending audio data to backend: " + e);
                    }
                }
            };
            recorder.start(chunkSize); // Emit data every X seconds
            setMediaRecorder(recorder);
            setRecording(true);
            // schedule poll function for transcription texts
            console.debug("Scheduling poll function.");
            let id = setInterval(pollTranscriptions, 5000);
            console.debug("Interval id from setInterval: " + id);
            setIntervalId(id);
        } catch (error) {
            console.error("Error accessing microphone:", error);
        }
    };

    const stopRecording = () => {
        console.debug("Stopping to record.")
        if (mediaRecorder) {
            mediaRecorder.stop();
            setRecording(false);
        }
    };

    const stopPoll = () => {
        if (intervalId && Number.isInteger(intervalId)) {
            console.debug("Stopping the poll function.")
            clearInterval(intervalId);
            setIntervalId(null);
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
                                if (transcription.transcription_text !== "SILENT_AUDIO_CHUNK") {
                                    // Add the transcription to the state
                                    console.debug("Setting transcription text for requestId: " + transcription.request_id)
                                    setTranscriptions((prev) => [...prev, transcription.transcription_text]);
                                } else {
                                    console.debug("Silent audio chunk for requestId: " + transcription.request_id)
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
        }
    };

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