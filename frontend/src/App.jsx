import React, {useEffect, useRef, useState} from "react";
import {csrfToken} from "./csrf.js";
import {MediaRecorder, register} from 'extendable-media-recorder';
import {connect} from 'extendable-media-recorder-wav-encoder';
import Settings from "./Settings.jsx";

await register(await connect());

const App = () => {
    const getInitialString = (keyname, value) => {
        const dataFromSession = sessionStorage.getItem(keyname);
        return dataFromSession ? JSON.parse(dataFromSession) : value;
    }
    const [modelSize, setModelSize] = useState(getInitialString("modelSize", "large-v3"))
    const [language, setLanguage] = useState(getInitialString("language", "auto"))
    const [recording, setRecording] = useState(false);
    const recordingRef = useRef(recording);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [mediaStream, setMediaStream] = useState(null);
    const [analyser, setAnalyser] = useState(null);
    const [intervalId, setIntervalId] = useState(null);
    const intervalIdRef = useRef(intervalId);
    const [requestIds, setRequestIds] = useState([]); // Store request Ids
    const requestIdsRef = useRef(requestIds);
    const [transcriptions, setTranscriptions] = useState([]); // Store transcriptions
    const [showSettings, setShowSettings] = useState(false);
    const [sections, setSections] = useState([
        { title: "Recording Section 1", isRecording: false, audioLevel: 0, duration: 0, animationFrameId: null, titleLocked: false, audioUrl: null, audioPath: null },
    ]);
    const [currentSection, setCurrentSection] = useState(0);
    const [socket, setSocket] = useState(null);
    const socketRef = useRef(null);
    const [initiateRecordingFlag, setInitiateRecordingFlag] = useState(false);
    const [recordingId, setRecordingId] = useState(null);

    // TODO: state management, read state from session and server where appropriately

    useEffect(() => {
        // TODO: wss and authentication? authentication middleware
        const ws = new WebSocket("ws://localhost:8001/ws/dictaphone/data/");
        //const ws = new WebSocket("wss://localhost:8001/ws/dictaphone/data/");
        ws.onopen = () => console.log("WebSocket connected");
        ws.onclose = () => console.log("WebSocket disconnected");
        // TODO: error handling, UI should be able show a proper message to the user
        ws.onerror = (e) => console.error("WebSocket error", e);
        ws.onmessage = (e) => receiveMessage(e);
        socketRef.current = ws;
        setSocket(ws);

        // Clean up on unmount
        return () => {
            console.debug("Calling close...")
            if (ws.readyState === WebSocket.OPEN) {
                console.debug("Closing web socket connection.")
                ws.close();
            }
        };
    }, []);

    const receiveMessage = async (message) => {
        // client receives three types of messages
        // 1) acknowledgments: this can be "ack_start_recording", "ack_stop_recording", "recording_complete" or "ack_chunk"
        // 2) data_request: request a missing data chunk, "request_chunk"
        // 3) output_files: transcribed files, "deliver_output"
        try {
            const data = JSON.parse(message.data);
            if (data.message_type) {
                console.debug("Message type received from backend: " + data.message_type);
                switch (data.message_type) {
                    case "ack_start_recording":
                        // handle start recording acknowledgment
                        if (data.recording_id) {
                            let updatedRecordingId = data.recording_id;
                            setRecordingId(updatedRecordingId);
                            await startRecording(currentSection, updatedRecordingId);
                        } else {
                            console.debug("No recording id returned.");
                        }
                        break;
                    case "ack_stop_recording":
                        // handle stop recording acknowledgment
                        break;
                    case "ack_chunk":
                        // handle chunk acknowledgment
                        // TODO:
                        console.debug("Chunk acknowledgment received.")
                        if (data.chunk_index != null) {
                            console.debug("Ack. chunk index: " + data.chunk_index);
                        }
                        break;
                    case "recording_complete":
                        // recording is verified to be complete from server (no missing chunks)
                        // TODO: list of recordingIds? activeRecordingId?
                        setRecordingId(null);
                        break;
                    case "request_chunk":
                        // handle data request for missing chunk
                        // TODO:
                        break;
                    case "deliver_output":
                        // handle transcribed file links
                        // TODO:
                        break;
                    default:
                        // handle unknown types
                        console.debug("Unknown message_type from backend (raw):", data);
                        break;
                }
            } else {
                console.debug("Message from backend (raw):", data);
            }
        } catch (e) {
            // TODO: error handling
            console.error("Failed to parse message from backend:", message.data);
        }
    }

    const sendControlMessage = (message, parameter) => {
        const ws = socketRef.current;
        console.debug("Sending control message, socket state:", ws);
        if (parameter) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    'type': "control_message",
                    'message': message,
                    'parameter': parameter
                }));
            } else {
                console.error("WebSocket is not open or not initialized.");
            }
        } else {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    'type': "control_message",
                    'message': message
                }));
            } else {
                console.error("WebSocket is not open or not initialized.");
            }
        }
    }

    const sendBinaryData = (data) => {
        const ws = socketRef.current;
        console.debug("Sending binary data, socket state:", ws);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        } else {
            console.error("WebSocket is not open or not initialized.");
        }
    };

    const sendMessage = () => {
        socket.send(JSON.stringify({
            'type': "control_message",
            'message': "start_recording"
        }))
        socket.send(JSON.stringify({
            'type': "acknowledgement",
            'chunk_index': 0
        }))
    }

    const createChunkHeader = (recordingId, chunkIndex) => {
        const header = new ArrayBuffer(8);
        const view = new DataView(header);
        view.setUint32(0, recordingId);
        view.setUint32(4, chunkIndex);
        return header;
    }

    useEffect(() => {
        sessionStorage.setItem("modelSize", JSON.stringify(modelSize))
    }, [modelSize]);
    useEffect(() => {
        sessionStorage.setItem("language", JSON.stringify(language))
    }, [language]);

    const goToPreviousSection = () => {
        setCurrentSection((prev) => Math.max(prev - 1, 0));
    };

    const goToNextSection = () => {
        setCurrentSection((prev) => Math.min(prev + 1, sections.length - 1));
    };

    const addSection = () => {
        setSections((prevSections) => {
            const newSections = [
                ...prevSections,
                {
                    title: `Recording Section ${prevSections.length + 1}`,
                    isRecording: false,
                    audioLevel: 0,
                    duration: 0,
                    titleLocked: false,
                    audioUrl: null,
                    audioPath: null
                }
            ];
            setCurrentSection(newSections.length - 1); // Navigate to new section
            return newSections;
        });
    };

    const handleTitleChange = (e, index) => {
        const value = e.target.value.replace(/[^a-zA-Z0-9ÆæØøÅå ]/g, ""); // Remove special characters
        const updatedSections = [...sections];
        updatedSections[index].title = value;
        setSections(updatedSections);
        // Dynamically adjust the input width
        const inputElement = e.target;
        inputElement.style.width = `${Math.max(inputElement.value.length * 0.6, 10)}em`;
    };

    const initiateRecording = () => {
        setInitiateRecordingFlag(true);
        sendControlMessage("start_recording", sections[currentSection].title);
        // TODO: do I need anything here to show to the user this is being set up?
        // TODO: maybe not (since it happens very fast) - maybe just errorhandling in case it takes to long or fails, will this be handle by general error handling when the serer is not responding?
    }

    const startRecording = async (index, updatedRecordingId) => {
        const updatedSections = [...sections];
        updatedSections[index].isRecording = true;
        updatedSections[index].startTime = Date.now(); // Record the start time
        setSections(updatedSections);

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
        const analyserInstance = audioContext.createAnalyser();
        analyserInstance.fftSize = 256;
        source.connect(analyserInstance);
        setAnalyser(analyserInstance)
        const mediaRecorderInstance = new MediaRecorder(streamInstance,{ mimeType: 'audio/wav' });
        setMediaRecorder(mediaRecorderInstance);
        setInitiateRecordingFlag(false);
        setRecording(true);

        let chunkIndex = 0;
        mediaRecorderInstance.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.debug("Sending binary data to backend.")
                // 1. Create header
                const header = createChunkHeader(updatedRecordingId, chunkIndex);
                // 2. Read audio chunk as ArrayBuffer and concatenate
                event.data.arrayBuffer().then(dataBuffer => {
                    // 3. Concatenate header and data
                    const totalLength = header.byteLength + dataBuffer.byteLength;
                    const combined = new Uint8Array(totalLength);
                    combined.set(new Uint8Array(header), 0);
                    combined.set(new Uint8Array(dataBuffer), header.byteLength);
                    // 4. Send through WebSocket
                    sendBinaryData(combined.buffer);
                });
                chunkIndex += 1;
            }
        };

        mediaRecorderInstance.onstop = async () => {
            console.debug("Media recorder onstop().");
        };

        const dataArray = new Uint8Array(analyserInstance.frequencyBinCount);

        function checkAudioLevel() {
            console.debug("Running checkAudioLevel()");
            analyserInstance.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
            //console.debug("Average: " + average);
            // update audio level
            updatedSections[index].audioLevel = average / 255; // Normalize to a range of 0 to 1
            // update recording duration
            updatedSections[index].duration = Math.floor((Date.now() - updatedSections[index].startTime) / 1000);
            setSections([...updatedSections]);
            let animationFrameRequestId = requestAnimationFrame(checkAudioLevel);
            //console.debug("AnimationFrameRequestId: " + animationFrameRequestId);
            updatedSections[index].animationFrameId = animationFrameRequestId;
        }
        checkAudioLevel();
        // TODO: create test data for the backend with 3 s. packets (5 packets?), add header before sending
        mediaRecorderInstance.start(3000)
        //mediaRecorderInstance.start(10000)
    };

    const stopRecording = (index) => {
        const updatedSections = [...sections];
        updatedSections[index].isRecording = false;
        updatedSections[index].audioLevel = 0;
        // Lock the title after recording so that the file name can be used for file processing with backend
        updatedSections[index].titleLocked = true;
        setSections(updatedSections);
        setRecording(false);
        if (updatedSections[index].animationFrameId) {
            console.debug("Stopping the animation frame...");
            cancelAnimationFrame(updatedSections[index].animationFrameId);
        }
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            console.debug("Stopping the recording...");
            mediaRecorder.stop(); // Stop the MediaRecorder
        } else {
            console.debug("MediaRecorder is not active or already stopped.");
        }
        if (analyser) {
            console.debug("Stopping the analyser...")
            analyser.disconnect()
        }
        if (mediaStream) {
            console.debug("Stopping the stream...");
            mediaStream.getTracks().forEach(track => track.stop());
        }
        console.debug("Stopped recording, sending control message.");
        sendControlMessage("stop_recording", null)
    };

    const formatDuration = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    };

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

    const onUpdateModel = (modelSize) => {
        setModelSize(modelSize)
    }

    const onUpdateLanguage = (language) => {
        setLanguage(language)
    }

    const resetRecording = async (file_path, index) => {
        // delete the recording in the backend
        console.debug("Deleting recording: " + file_path);
        // Prepare the form data
        const formData = new FormData();
        formData.append("file_path", file_path);
        try {
            const response = await fetch("http://localhost:8000/reset-recording/", {
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
            console.debug("Error deleting recording: " + e);
        }
        const updatedSections = [...sections];
        // unlock the title after resetting the recording so that the user can rename if needed
        updatedSections[index].titleLocked = false;
        // reset the audio url
        updatedSections[index].audioUrl = null;
        updatedSections[index].audioPath = null;
        setSections(updatedSections);
    }

    return (
        <div className='App'>
            <h1>Dictaphone prototype</h1>
            <button className="transcribe-button" onClick={showOrHideSettings}>
                {showSettings ? 'Hide settings' : 'Show settings'}
            </button>
            <button className="transcribe-button" onClick={resetServerData}>
                Reset server data
            </button>
            {
                showSettings && (
                    <Settings
                        onUpdateModel={onUpdateModel}
                        currentModelSize={modelSize}
                        onUpdateLanguage={onUpdateLanguage}
                        currentLanguage={language}
                    />
                )
            }

            <div>
                <div className="recording-section">
                    <div className="recording-header">
                        <input
                            type="text"
                            value={sections[currentSection].title}
                            onChange={(e) => handleTitleChange(e, currentSection)}
                            className="section-title-input"
                            maxLength="30" // Limit to 30 characters
                            placeholder="Enter title"
                            disabled={sections[currentSection].titleLocked}
                        />
                        <button className="add-section-button" onClick={addSection} title="Add new recording">+</button>
                    </div>
                    <div className="recording-content">
                        <button className="transcribe-button" onClick={() => initiateRecording(currentSection)}
                                disabled={recording || sections[currentSection].audioUrl}>
                            Start recording
                        </button>
                        <button className="transcribe-stop-button" onClick={() => stopRecording(currentSection)}
                                disabled={!recording}>
                            Stop recording
                        </button>
                        <button className="transcribe-stop-button"
                                onClick={() => resetRecording(sections[currentSection].audioPath, currentSection)}
                                disabled={recording || !sections[currentSection].audioUrl}>
                            Reset recording
                        </button>
                        <div className="audio-level-container">
                            <label htmlFor={`audio-level-${currentSection}`}>Audio Level:</label>
                            <progress
                                id={`audio-level-${currentSection}`}
                                className="audio-level-gauge"
                                value={sections[currentSection].audioLevel}
                                max="1"
                            ></progress>
                        </div>
                        <div className="recording-duration">
                            <label>Duration: </label>
                            <span>{formatDuration(sections[currentSection].duration)}</span>
                        </div>
                        {sections[currentSection].audioUrl && (
                            <audio
                                controls
                                src={sections[currentSection].audioUrl}
                                style={{width: "100%", marginTop: "10px"}}
                            >
                                Your browser does not support the audio element.
                            </audio>
                        )}
                        <div style={{marginTop: 10}}>
                            <button className="transcribe-button" onClick={() => console.debug("test")}
                                    disabled={recording || !sections[currentSection].audioUrl}>
                                Start transcription
                            </button>
                            <button className="transcribe-stop-button" onClick={() => console.debug("test")}
                                    disabled={true}>
                                Stop transcription
                            </button>
                        </div>
                        <h3>Transcription Status</h3>
                        <p>Here the status will be shown.</p>
                        <h3>Transcribed text</h3>
                        <p>Here the transcribed text will be available.</p>
                    </div>
                    <div className="section-navigation"
                         style={{display: "flex", justifyContent: "center", marginTop: 20}}>
                        <button onClick={goToPreviousSection} disabled={currentSection === 0}>
                            Previous
                        </button>
                        <span style={{margin: "0 10px"}}>
                                Recording {currentSection + 1} of {sections.length}
                            </span>
                        <button onClick={goToNextSection} disabled={currentSection === sections.length - 1}>
                            Next
                        </button>
                    </div>
                </div>
                <div>
                    <h2>Test button for testing websockets</h2>
                    <button className="transcribe-button" onClick={() => sendMessage()}>
                        Test send message
                    </button>
                </div>
            </div>
        </div>
    );
};

export default App;