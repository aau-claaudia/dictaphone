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

    useEffect(() => {
        sessionStorage.setItem("modelSize", JSON.stringify(modelSize))
    }, [modelSize]);
    useEffect(() => {
        sessionStorage.setItem("language", JSON.stringify(language))
    }, [language]);

    const addSection = () => {
        setSections([...sections, {
            title: `Recording Section ${sections.length + 1}`,
            isRecording: false,
            audioLevel: 0,
            duration: 0,
            titleLocked: false,
            audioUrl: null,
            audioPath: null
        }]);
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

    const startRecording = async (index) => {
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
        let audioChunks = [];

        mediaRecorderInstance.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.debug("Pushing data chunk to buffer array.")
                audioChunks.push(event.data);
            }
        };

        mediaRecorderInstance.onstop = async () => {
            console.debug("Capturing audio, size of array: ", audioChunks.length);
            // Process or save the audio chunks here
            if (audioChunks.length > 0) {
                const body = new Blob(audioChunks, { type: "audio/wav" })
                // Prepare the form data
                const formData = new FormData();
                // TODO: handle empty filename (validation in UI - also lock title name after recording has started?)
                formData.append("audio_chunk", body, (updatedSections[index].title + ".wav"));

                //TODO: use relative links and proxy
                try {
                    // TODO: add upload progress on file
                    const response = await fetch("http://localhost:8000/upload-audio-chunk/", {
                        method: "POST",
                        credentials: 'include', // Include cookies
                        headers: {
                            'X-CSRFToken': csrfToken, // Include the CSRF token
                        },
                        body: formData,
                    });
                    if (response.ok) {
                        const fileData = await response.json();
                        console.debug(fileData);
                        updatedSections[index].audioUrl = fileData.file_url;
                        updatedSections[index].audioPath = fileData.file_path;
                        setSections(updatedSections);
                    }
                    audioChunks = [];
                } catch (e) {
                    // Handle network errors
                    console.debug("Error sending audio data to backend: " + e);
                }
            }
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
        setRecording(true);
        mediaRecorderInstance.start(10000)
        // TODO: poll scheduling code needed later
        //console.debug("Scheduling poll function.");
        //let id = setInterval(pollTranscriptions, 5000);
        //console.debug("Interval id from setInterval: " + id);
        //setIntervalId(id);
        // request id update code:
        // Add the request ID to the state
        //setRequestIds((prevIds) => [...prevIds, queueRequestData.request_id]);
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
                {sections.map((section, index) => (
                    <div key={index} className="recording-section">
                        <div className="recording-header">
                            <input
                                type="text"
                                value={section.title}
                                onChange={(e) => handleTitleChange(e, index)}
                                className="section-title-input"
                                maxLength="30" // Limit to 30 characters
                                placeholder="Enter title"
                                disabled={section.titleLocked}
                            />
                            <button className="add-section-button" onClick={addSection}>+</button>
                        </div>
                        <div className="recording-content">
                            <button className="transcribe-button" onClick={() => startRecording(index)}
                                    disabled={section.isRecording || section.audioUrl}>
                                Start recording
                            </button>
                            <button className="transcribe-stop-button" onClick={() => stopRecording(index)}
                                    disabled={!section.isRecording}>
                                Stop recording
                            </button>
                            <button className="transcribe-stop-button" onClick={() => resetRecording(section.audioPath, index)}
                                    disabled={section.isRecording || !section.audioUrl}>
                                Reset recording
                            </button>
                            <div className="audio-level-container">
                                <label htmlFor={`audio-level-${index}`}>Audio Level:</label>
                                <progress
                                    id={`audio-level-${index}`}
                                    className="audio-level-gauge"
                                    value={section.audioLevel}
                                    max="1"
                                ></progress>
                            </div>
                            <div className="recording-duration">
                                <label>Duration: </label>
                                <span>{formatDuration(section.duration)}</span>
                            </div>
                            {section.audioUrl && (
                                <audio
                                    controls
                                    src={section.audioUrl}
                                    style={{width: "100%", marginTop: "10px"}}
                                >
                                    Your browser does not support the audio element.
                                </audio>
                            )}
                            <div style={{marginTop: 10}}>
                                <button className="transcribe-button" onClick={() => console.debug("test")}
                                        disabled={section.isRecording || !section.audioUrl}>
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
                    </div>
                ))}
            </div>

        </div>
    );
};

export default App;