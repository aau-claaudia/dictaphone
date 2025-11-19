import React, {useEffect, useRef, useState} from "react";
import {MediaRecorder, register} from 'extendable-media-recorder';
import {connect} from 'extendable-media-recorder-wav-encoder';
import Settings from "./Settings.jsx";
import Results from "./Results.jsx";
import ErrorOverlay from "./Overlay.jsx";
import {RecordingStatus} from './Constants.jsx';
import TranscriptionStatus from "./TranscriptionStatus.jsx";
import dictaphoneImage from "./assets/dictaphone_logo_690x386.png";
import RecordingSettings from "./RecordingSettings.jsx";

let isWavLibraryRegistered = false;

const App = () => {
    const getInitialString = (keyname, value) => {
        const dataFromSession = sessionStorage.getItem(keyname);
        return dataFromSession ? JSON.parse(dataFromSession) : value;
    }
    const getInitialInteger = (keyname, value) => {
        const dataFromSession = sessionStorage.getItem(keyname);
        return dataFromSession ? parseInt(JSON.parse(dataFromSession), 10) : parseInt(value, 10);
    }
    const [modelSize, setModelSize] = useState("large-v3");
    const [modelList, setModelList] = useState([]);
    const [language, setLanguage] = useState(getInitialString("language", "auto"))
    const micBoostLevel = useRef(getInitialInteger("micBoostLevel", 1))
    const [recording, setRecording] = useState(false);
    const chunkIndexRef = useRef(0);
    const recordingRef = useRef(recording);
    const mediaRecorderRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const analyserRef = useRef(null);
    const [showRecordingSettings, setShowRecordingSettings] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [sections, setSections] = useState([
        {
            title: "Recording 1",
            recordingId: null,
            isRecording: false,
            isInitiating: false,
            audioLevel: 0,
            duration: 0,
            animationFrameId: null,
            titleLocked: false,
            audioUrl: null,
            audioPath: null,
            size: null,
            finalizing: false,
            finalization_status: null,
            transcribing: false,
            transcriptionStartTime: null,
            taskId: null,
            transcriptionResults: null
        },
    ]);
    const sectionsRef = useRef(sections);
    const [currentSection, setCurrentSection] = useState(0);
    const currentSectionRef = useRef(currentSection);
    const socketRef = useRef(null);
    const chunkInventoryRef = useRef(new Map());
    const [error, setError] = useState(null);

    // Determine protocol (ws or wss) based on the page's protocol (http or https)
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

    useEffect(() => {
        const ws = new WebSocket(`${protocol}://${window.location.host}/ws/dictaphone/data/`);
        ws.onopen = () => initializeState();
        ws.onclose = () => handleDisconnect();
        ws.onerror = (e) => handleWebSocketError(e);
        ws.onmessage = (e) => receiveMessage(e);
        socketRef.current = ws;

        // Clean up on unmount
        return () => {
            console.debug("Calling close...")
            if (ws.readyState === WebSocket.OPEN) {
                console.debug("Closing web socket connection.")
                ws.close();
            }
        };
    }, []);

    useEffect(() => {
        // Ensure that the module is only registered one time
        if (!isWavLibraryRegistered) {
            const registerWavLibrary = async () => {
                await register(await connect());
            };
            registerWavLibrary().catch(console.error);
            // Set the flag so this block doesn't run again
            isWavLibraryRegistered = true;
        }
    }, []);

    useEffect(() => {
        recordingRef.current = recording;
    }, [recording]);
    useEffect(() => {
        sectionsRef.current = sections;
    }, [sections]);
    useEffect(() => {
        currentSectionRef.current = currentSection;
    }, [currentSection]);
    useEffect(() => {
        sessionStorage.setItem("language", JSON.stringify(language))
    }, [language]);

    const handleRefresh = () => {
        window.location.reload();
    };

    const initializeState = async () => {
        console.log("WebSocket connected");
        sendControlMessage("initialize");
    }

    const handleDisconnect = async () => {
        console.log("WebSocket disconnected");
        setError(new Error("The client was disconnected from the server. Data recorded before disconnecting can be found on the server. Active transcriptions will keep running on the server unless the server was stopped."));
        // The server disconnected. Stop the active recording and clear the chunk inventory.
        stopRecordingOnDisconnect();
    }

    const handleWebSocketError = async (e) => {
        console.log("WebSocket error", e);
        setError(new Error("Server communication error detected. Please check your connection."));
    }

    // Function to determine the best default model based on availability and preference order.
    const getDefaultModel = (list) => {
        const preferenceOrder = ["large-v3", "large-v3-turbo", "medium", "small", "base"];
        const availableModels = list.map(modelStr => {
            const [modelName] = modelStr.split(' ');
            const isDisabled = modelStr.includes("(not enough memory)");
            return { name: modelName, disabled: isDisabled };
        });

        for (const preferredModel of preferenceOrder) {
            const model = availableModels.find(m => m.name === preferredModel);
            if (model && !model.disabled) {
                return model.name;
            }
        }
        // Fallback to the first available model if no preferred models are available
        return availableModels.find(m => !m.disabled)?.name || '';
    };

    const receiveMessage = async (message) => {
        // client receives three types of messages
        // 1) acknowledgments: this can be "ack_start_recording", "ack_stop_recording", "recording_complete" or "ack_chunk"
        // 2) data request: request a missing data chunk, "request_chunk"
        // 3) output files: transcribed files, "transcribed_file"
        // 4) server data for initializing the app: "initialization_data"
        try {
            const data = JSON.parse(message.data);
            if (data.message_type) {
                console.debug("Message type received from backend: " + data.message_type);
                switch (data.message_type) {
                    case "initialization_data":
                        if (data.recordings && data.recordings.length > 0) {
                            const initializationSections = [];
                            data.recordings.forEach(item => {
                                //console.debug("Recording:", item);
                                let transcriptionStart = null;
                                let transcribingFlag = false;
                                if (item.transcription_start_time) {
                                    transcriptionStart = Date.parse(item.transcription_start_time);
                                    transcribingFlag = true;
                                }
                                let fileSize = null;
                                if (item.file_size) {
                                    fileSize = item.file_size;
                                }
                                let sectionObject = {
                                    title: item.title,
                                    recordingId: item.recording_id,
                                    isRecording: false,
                                    isInitiating: false,
                                    audioLevel: 0,
                                    duration: 0,
                                    animationFrameId: null,
                                    titleLocked: true,
                                    audioUrl: item.recording_file_path,
                                    audioPath: null,
                                    size: fileSize,
                                    finalizing: false,
                                    finalization_status: item.status,
                                    transcribing: transcribingFlag,
                                    transcriptionStartTime: transcriptionStart,
                                    taskId: null,
                                    transcriptionResults: item.results
                                }
                                initializationSections.push(sectionObject);
                            })
                            initializationSections.sort((a, b) => a.recordingId - b.recordingId);
                            setSections(initializationSections);
                        } else {
                            console.debug("No initialization recording data returned.");
                        }
                        if (data.model_list && data.model_list.length > 0) {
                            // update the list of whisper models
                            //console.debug(data.model_list)
                            setModelSize(getDefaultModel(data.model_list))
                            setModelList(data.model_list);
                        } else {
                            console.debug("No whisper models returned.");
                        }
                        break;
                    case "ack_start_recording":
                        // handle start recording acknowledgment
                        if (data.recording_id) {
                            let updatedRecordingId = data.recording_id;
                            await startRecording(currentSectionRef.current, updatedRecordingId);
                        } else {
                            console.debug("No recording id returned.");
                            setError(new Error("The server is not functioning as expected - no Recording ID returned. Contact your software provider."));
                        }
                        break;
                    case "ack_chunk":
                        // handle chunk acknowledgment
                        console.debug("Chunk acknowledgment received.")
                        if (data.chunk_index != null) {
                            const acknowledgedChunkIndex = parseInt(data.chunk_index, 10);
                            if (isNaN(acknowledgedChunkIndex)) {
                                console.warn("Received an invalid chunk index from server:", data.chunk_index);
                                break;
                            }
                            if (chunkInventoryRef.current.has(acknowledgedChunkIndex)) {
                                chunkInventoryRef.current.delete(acknowledgedChunkIndex);
                                console.debug(`Chunk ${data.chunk_index} acknowledged by server and removed from inventory.`);
                            } else {
                                console.warn(`Received acknowledgement for unknown chunk index: ${acknowledgedChunkIndex}.`);
                            }
                        } else {
                            console.warn("Warning, no chunk index data in acknowledgment.");
                        }
                        break;
                    case "recording_complete": {
                        // recording finalization on server is complete
                        console.debug("Recording complete received from server.")
                        console.debug("File path:", data.path);
                        console.debug("File size:", data.size);
                        console.debug("Recording ID:", data.recording_id);
                        console.debug("Completion status:", data.completion_status);

                        const updatedSections = [...sectionsRef.current];

                        updatedSections.forEach(section => {
                            if (section.recordingId === data.recording_id) {
                                console.debug("Updating section with recording ID:", data.recording_id);
                                section.audioUrl = data.path;
                                section.finalization_status = data.completion_status;
                                section.size = data.size;
                                section.finalizing = false;
                            }
                        })
                        setSections(updatedSections);

                        // reset the chunk inventory Map
                        // console.debug("Chunk inventory size before clearing:", chunkInventoryRef.current.size);
                        chunkInventoryRef.current.clear();
                        // console.debug("Chunk inventory size after clearing:", chunkInventoryRef.current.size);
                        break;
                    }
                    case "request_chunk":
                        // handle data request for missing chunk
                        console.debug("Chunk request received from server for chunk: ", data.chunk_index);
                        if (data.chunk_index != null) {
                            const acknowledgedChunkIndex = parseInt(data.chunk_index, 10);
                            if (isNaN(acknowledgedChunkIndex)) {
                                console.warn("Received an invalid chunk index in chunk request from server: ", data.chunk_index);
                                break;
                            }
                            if (chunkInventoryRef.current.has(acknowledgedChunkIndex)) {
                                // re-send chunk to server
                                console.debug(`Re-sending chunk with index: ${acknowledgedChunkIndex} to server.`);
                                sendBinaryData(chunkInventoryRef.current.get(acknowledgedChunkIndex));
                            } else {
                                console.warn(`Received chunk request for unknown chunk index: ${acknowledgedChunkIndex}.`);
                            }
                        } else {
                            console.warn("Warning, no chunk index data in chunk request.");
                        }
                        break;
                    case "transcription_started": {
                        // update UI with status
                        console.debug("Transcription started received from server.")
                        console.debug("Recording ID:", data.recording_id);
                        console.debug("File size:", data.file_size);
                        console.debug("Task ID:", data.task_id);

                        const updatedSections = [...sectionsRef.current];
                        updatedSections.forEach(section => {
                            if (section.recordingId === data.recording_id) {
                                console.debug("Updating section with transcription status for recording ID:", data.recording_id);
                                section.size = data.file_size;
                                section.taskId = data.task_id;
                            }
                        })
                        setSections(updatedSections);
                        break;
                    }
                    case "transcription_completed": {
                        // handle transcribed file links
                        console.debug("Transcription results received from server.")
                        console.debug("Recording ID:", data.recording_id);
                        console.debug("Task ID:", data.task_id);
                        //console.debug("Results:", data.results)

                        const updatedSections = [...sectionsRef.current];
                        updatedSections.forEach(section => {
                            if (section.recordingId === data.recording_id) {
                                console.debug("Updating section with transcription results for recording ID:", data.recording_id);
                                section.transcribing = false;
                                section.transcriptionStartTime = null;
                                section.taskId = null
                                section.transcriptionResults = data.results;
                            }
                        })
                        setSections(updatedSections);
                        break;
                    }
                    default:
                        // handle unknown types
                        console.debug("Unknown message_type from backend (raw):", data);
                        break;
                }
            } else {
                console.debug("Message from backend (raw):", data);
            }
        } catch (e) {
            console.error("Failed to parse message from backend:", message.data);
            setError(new Error("Unexpected error. Contact your software provider."));
        }
    }

    const getStatusMessage = (status) => {
        switch (status) {
            case RecordingStatus.VERIFIED:
                return 'VERIFIED';
            case RecordingStatus.INTERRUPTED_VERIFIED:
                return 'INTERRUPTED, VERIFIED';
            case RecordingStatus.DATA_LOSS:
                return 'DATA LOSS';
            case RecordingStatus.INTERRUPTED_NOT_VERIFIED:
                return 'INTERRUPTED';
            default:
                return 'Unknown status.';
        }
    }

    const getStatusDescription = (status) => {
        switch (status) {
            case RecordingStatus.VERIFIED:
                return 'Recording completed and verified.';
            case RecordingStatus.INTERRUPTED_VERIFIED:
                return 'Recording was interrupted, but all received data is verified.';
            case RecordingStatus.DATA_LOSS:
                return 'Error: Data loss detected. The recording is incomplete.';
            case RecordingStatus.INTERRUPTED_NOT_VERIFIED:
                return 'Recording was interrupted and could not be verified.';
            default:
                return 'Unknown status.';
        }
    }

    const getStatusStyling = (status) => {
        switch (status) {
            case RecordingStatus.VERIFIED:
                return 'verified-file';
            case RecordingStatus.INTERRUPTED_VERIFIED:
                return 'verified-interrupted';
            case RecordingStatus.DATA_LOSS:
                return 'data-loss';
            case RecordingStatus.INTERRUPTED_NOT_VERIFIED:
                return 'verified-interrupted';
            default:
                return 'Unknown status.';
        }
    }

    const sendControlMessage = (message, parameter) => {
        const ws = socketRef.current;
        console.debug("Sending control message.");
        //console.debug("Socket state:", ws);
        if (parameter) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    'type': "control_message",
                    'message': message,
                    'parameter': parameter
                }));
            } else {
                console.debug("WebSocket is not open or not initialized.");
            }
        } else {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    'type': "control_message",
                    'message': message
                }));
            } else {
                console.debug("WebSocket is not open or not initialized.");
            }
        }
    }

    const sendBinaryData = (data) => {
        const ws = socketRef.current;
        console.debug("Sending binary data.");
        //console.debug("Socket state:", ws);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        } else {
            console.debug("WebSocket is not open or not initialized.");
        }
    };

    const createChunkHeader = (recordingId, chunkIndex) => {
        const header = new ArrayBuffer(8);
        const view = new DataView(header);
        view.setUint32(0, recordingId);
        view.setUint32(4, chunkIndex);
        return header;
    }

    const goToPreviousSection = () => {
        setCurrentSection((prev) => prev - 1);
    };

    const goToNextSection = () => {
        setCurrentSection((prev) => prev + 1);
    };

    const addSection = () => {
        setSections((prevSections) => {
            const newSections = [
                ...prevSections,
                {
                    title: `Recording ${prevSections.length + 1}`,
                    recordingId: null,
                    isRecording: false,
                    isInitiating: false,
                    audioLevel: 0,
                    duration: 0,
                    animationFrameId: null,
                    titleLocked: false,
                    audioUrl: null,
                    audioPath: null,
                    size: null,
                    finalizing: false,
                    finalization_status: null,
                    transcribing: false,
                    transcriptionStartTime: null,
                    taskId: null,
                    transcriptionResults: null
                }
            ];
            setCurrentSection(newSections.length - 1); // Navigate to new section
            return newSections;
        });
    };

    const handleTitleChange = (e, index) => {
        const value = e.target.value.replace(/[^a-zA-Z0-9ÆæØøÅå ]/g, ""); // Remove special characters
        const updatedSections = [...sectionsRef.current];
        updatedSections[index].title = value;
        setSections(updatedSections);
        // Dynamically adjust the input width
        const inputElement = e.target;
        inputElement.style.width = `${Math.max(inputElement.value.length * 0.6, 10)}em`;
    };

    const initiateRecording = async (index) => {
        let streamInstance;
        try {
            // Request access to the microphone
            streamInstance = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: false,
                    echoCancellation: false
                }
            });
            mediaStreamRef.current = streamInstance;
            const updatedSections = [...sectionsRef.current];
            updatedSections[index].isInitiating = true;
            setSections(updatedSections);
            sendControlMessage("start_recording", sections[currentSection].title);
        } catch (e) {
            console.debug("Error when getting access to user mic.", e);
            setError(new Error("Could not get access to the microphone. Please enable in the top left corner and refresh the page."));
        }
    }

    const startTranscription = (recordingId) => {
        // update the section (start time and transcribing flag
        const updatedSections = [...sectionsRef.current];
        updatedSections.forEach(section => {
            if (section.recordingId === recordingId) {
                console.debug("Updating section with transcription details for recording ID:", recordingId);
                section.transcribing = true;
                section.transcriptionStartTime = Date.now();
            }
        })
        setSections(updatedSections);
        // send control message to backend
        sendControlMessage("start_transcription", {
            recordingId: recordingId,
            model: modelSize,
            language: language
        });
    }

    const cancelTranscription = (recordingId) => {
        // update the section (start time and transcribing flag
        const updatedSections = [...sectionsRef.current];
        let taskId = null;
        updatedSections.forEach(section => {
            if (section.recordingId === recordingId) {
                console.debug("Transcription cancelled, updating section with recording ID:", recordingId);
                section.transcribing = false;
                section.transcriptionStartTime = null;
                taskId = section.taskId;
                section.taskId = null;
            }
        })
        setSections(updatedSections);
        // send control message to backend
        if (taskId) {
            console.debug("Cancelling task with recordingId: " + recordingId + " and taskId: " + taskId);
            sendControlMessage("cancel_transcription", {
                recordingId: recordingId,
                taskId: taskId,
            });
        }
    }

    const startRecording = async (index, updatedRecordingId) => {
        const updatedSections = [...sectionsRef.current];
        updatedSections[index].isRecording = true;
        updatedSections[index].recordingId = updatedRecordingId;
        updatedSections[index].startTime = Date.now(); // Record the start time
        // Lock the title so that the file name can be used for file processing with backend
        updatedSections[index].titleLocked = true;
        updatedSections[index].isInitiating = false;
        setSections(updatedSections);

        const audioContext = new AudioContext();

        const defaultSource = audioContext.createMediaStreamSource(mediaStreamRef.current);
        // creating a gain node to set the mic level, amplify according to setting
        const gainNode = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();
        gainNode.gain.value = micBoostLevel.current;
        defaultSource.connect(gainNode);
        const analyserInstance = audioContext.createAnalyser();
        analyserInstance.fftSize = 256;
        gainNode.connect(analyserInstance);
        gainNode.connect(destination);
        analyserRef.current = analyserInstance;
        const mediaRecorderInstance = new MediaRecorder(destination.stream,{ mimeType: 'audio/wav' });
        mediaRecorderRef.current = mediaRecorderInstance;
        setRecording(true);

        chunkIndexRef.current = 0; // Reset chunk index for new recording
        mediaRecorderInstance.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.debug("Sending binary data to backend.")
                const currentChunkIndex = chunkIndexRef.current;
                // 1. Create header
                const header = createChunkHeader(updatedRecordingId, currentChunkIndex);
                // 2. Read audio chunk as ArrayBuffer and concatenate
                event.data.arrayBuffer().then(dataBuffer => {
                    // 3. Concatenate header and data
                    const totalLength = header.byteLength + dataBuffer.byteLength;
                    const combined = new Uint8Array(totalLength);
                    combined.set(new Uint8Array(header), 0);
                    combined.set(new Uint8Array(dataBuffer), header.byteLength);
                    // Store the chunk in chunk inventory map before sending.
                    chunkInventoryRef.current.set(currentChunkIndex, combined.buffer);
                    console.debug(`Stored chunk ${currentChunkIndex} for potential resend.`);
                    // 4. Send through WebSocket
                    sendBinaryData(combined.buffer);
                });
                chunkIndexRef.current += 1;
            }
        };

        mediaRecorderInstance.onstop = async () => {
            console.debug("Media recorder onstop() event fired. All data chunks have been generated.");
            // the recorder is fully stopped and the last chunk has been sent,
            // notify the server that the recording is finished from the client side.
            console.debug(`Sending stop_recording control message with total chunks: ${chunkIndexRef.current}`);
            sendControlMessage("stop_recording", chunkIndexRef.current);
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
            updatedSections[index].animationFrameId = requestAnimationFrame(checkAudioLevel);
        }
        checkAudioLevel();
        mediaRecorderInstance.start(2000) // data chunk size is 2 seconds of recording
    };

    const stopRecording = (index) => {
        const updatedSections = [...sectionsRef.current];
        updatedSections[index].isRecording = false;
        updatedSections[index].audioLevel = 0;
        updatedSections[index].finalizing = true;
        setSections(updatedSections);
        setRecording(false);
        if (updatedSections[index].animationFrameId) {
            console.debug("Stopping the animation frame...");
            cancelAnimationFrame(updatedSections[index].animationFrameId);
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            console.debug("Stopping the recording...");
            mediaRecorderRef.current.stop();
        }
        else {
            console.debug("MediaRecorder is not active or already stopped.");
        }
        stopAnalyser();
        stopStream();
    };

    const stopRecordingOnDisconnect = () => {
        setRecording(false);
        // clear the chunk inventory data
        chunkInventoryRef.current.clear();
        // update all sections
        const updatedSections = [...sectionsRef.current];
        updatedSections.forEach(item => {
            item.isRecording = false;
            item.audioLevel = 0;
            if (item.animationFrameId) {
                console.debug("Stopping the animation frame...");
                cancelAnimationFrame(item.animationFrameId);
            }
        })
        setSections(updatedSections);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            // Detach listeners to prevent any further events from firing
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current.onerror = null;
        }
        else {
            console.debug("MediaRecorder is not active or already stopped.");
        }
        stopAnalyser();
        stopStream();
    };

    const stopAnalyser = () => {
        if (analyserRef.current) {
            console.debug("Stopping the analyser...")
            analyserRef.current.disconnect();
        }
    }

    const stopStream = () => {
        if (mediaStreamRef.current) {
            console.debug("Stopping the stream...");
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
    }

    const formatDuration = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    };

    // Function for showing or hiding the settings
    const showOrHideSettings = () => {
        setShowSettings(!showSettings);
    }

    // Function for showing or hiding the recording settings
    const showOrHideRecordingSettings = () => {
        setShowRecordingSettings(!showRecordingSettings);
    }

    const onUpdateModel = (modelSize) => {
        setModelSize(modelSize)
    }

    const onUpdateLanguage = (language) => {
        setLanguage(language)
    }

    const onUpdateBoost = (boost) => {
        micBoostLevel.current = parseInt(boost, 10);
        sessionStorage.setItem("micBoostLevel", JSON.stringify(micBoostLevel.current))
    }

    return (
        <div className='App'>
            <ErrorOverlay
                error={error}
                onRefresh={handleRefresh}
            />
            <div className="title-container">
                <img src={dictaphoneImage} alt="Dictaphone" className="centered-image"/>
            </div>
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
                        <button className="add-section-button" onClick={addSection} title="Add new recording"
                                disabled={recording || sections[currentSection].isInitiating || sections[currentSection].finalizing}>
                            +
                        </button>
                    </div>
                    <div className="recording-content">
                        <button className="transcribe-button" onClick={() => initiateRecording(currentSection)}
                                disabled={recording || sections[currentSection].audioUrl || sections[currentSection].isInitiating || sections[currentSection].finalizing}>
                            {recording ? (sections[currentSection].isInitiating ? 'Initiating' : 'Recording') : 'Start recording'}
                        </button>
                        <button className="transcribe-stop-button" onClick={() => stopRecording(currentSection, true)}
                                disabled={!sections[currentSection].isRecording}>
                            {sections[currentSection].finalizing ? 'Verifying recording' : 'Stop recording'}
                        </button>
                        <button className="transcribe-button" onClick={showOrHideRecordingSettings}>
                            {showRecordingSettings ? 'Hide settings' : 'Show settings'}
                        </button>
                        {
                            showRecordingSettings && (
                                <RecordingSettings
                                    currentBoost={micBoostLevel.current}
                                    onUpdateBoost={onUpdateBoost}
                                />
                            )
                        }
                        {
                            !sections[currentSection].audioUrl && (
                                <div className="audio-level-container">
                                    <label htmlFor={`audio-level-${currentSection}`}>Audio Level:</label>
                                    <progress
                                        id={`audio-level-${currentSection}`}
                                        className="audio-level-gauge"
                                        value={sections[currentSection].audioLevel}
                                        max="1"
                                    ></progress>
                                </div>
                            )
                        }
                        {
                            !sections[currentSection].audioUrl && (
                                <div className="recording-duration">
                                    <label>Duration: </label>
                                    <span>{formatDuration(sections[currentSection].duration)}</span>
                                </div>
                            )
                        }
                        {
                            sections[currentSection].audioUrl && (
                                <div>
                                    <h3>
                                        Recording status: <span
                                        className={`${getStatusStyling(sections[currentSection].finalization_status)} tooltip-hint`}
                                        title={getStatusDescription(sections[currentSection].finalization_status)}
                                    >{getStatusMessage(sections[currentSection].finalization_status)}</span>
                                    </h3>
                                </div>
                            )
                        }
                        {sections[currentSection].audioUrl && (
                            <audio
                                controls
                                src={sections[currentSection].audioUrl}
                                style={{width: "100%", marginTop: "10px"}}
                            >
                                Your browser does not support the audio element.
                            </audio>
                        )}
                    </div>
                    <div>
                        <div style={{marginTop: 10}}>
                            <button className="transcribe-button"
                                    onClick={() => startTranscription(sections[currentSection].recordingId)}
                                    disabled={sections[currentSection].isRecording || !sections[currentSection].audioUrl || sections[currentSection].transcribing}>
                                {sections[currentSection].transcribing ? 'In progress' : 'Transcribe recording'}
                            </button>
                            <button className="transcribe-stop-button"
                                    onClick={() => cancelTranscription(sections[currentSection].recordingId)}
                                    disabled={!sections[currentSection].transcribing || !sections[currentSection].taskId}>
                                Cancel transcription
                            </button>
                            <button className="transcribe-button" onClick={showOrHideSettings}>
                                {showSettings ? 'Hide settings' : 'Show settings'}
                            </button>
                            {
                                showSettings && (
                                    <Settings
                                        onUpdateModel={onUpdateModel}
                                        currentModelSize={modelSize}
                                        onUpdateLanguage={onUpdateLanguage}
                                        currentLanguage={language}
                                        modelList={modelList}
                                    />
                                )
                            }
                        </div>
                        {
                            sections[currentSection].transcribing && (
                                <TranscriptionStatus
                                    size={sections[currentSection].size}
                                    startTime={sections[currentSection].transcriptionStartTime}
                                />
                            )
                        }
                        {
                            sections[currentSection].transcriptionResults && sections[currentSection].transcriptionResults.length > 1 && (
                                <Results
                                    results={sections[currentSection].transcriptionResults}
                                />
                            )
                        }
                    </div>
                    <div className="section-navigation"
                         style={{display: "flex", justifyContent: "center", marginTop: 20}}>
                        <button className="navigation-buttons" onClick={goToPreviousSection}
                                disabled={currentSection === 0}>
                            Previous
                        </button>
                        <span style={{margin: "0 10px"}}>
                                Recording {currentSection + 1} of {sections.length}
                            </span>
                        <button className="navigation-buttons" onClick={goToNextSection}
                                disabled={currentSection === sections.length - 1}>
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;