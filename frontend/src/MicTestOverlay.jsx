import React, { useState, useRef, useEffect, useCallback } from 'react';
import './MicTestOverlay.css';

const MAX_TEST_RECORDING_DURATION_MS = 10000; // Max duration for a single test recording (10 seconds)
const DEFAULT_BOOST_OPTIONS = [1, 2, 3, 5, 10, 20];

const MicTestOverlay = ({ mediaStream, initialMicBoostLevel, onSave, onClose }) => {
    const [isTesting, setIsTesting] = useState(false);
    const [isPlaybackActive, setIsPlaybackActive] = useState(false);
    const [currentMicBoostLevel, setCurrentMicBoostLevel] = useState(initialMicBoostLevel || 1.0);
    const [audioInputLevel, setAudioInputLevel] = useState(0); // Normalized 0-1 for UI visualizer
    const [playbackAudioBlob, setPlaybackAudioBlob] = useState(null);

    // Refs for audio processing instances
    const audioContextRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const gainNodeRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameIdRef = useRef(null); // For requestAnimationFrame loop
    const recordedChunksRef = useRef([]);
    const recordingStartTimeRef = useRef(null);

    // --- Audio Setup and Teardown ---
    const setupAudio = useCallback(() => {
        if (!mediaStream) {
            console.error("No media stream available for mic test.");
            return;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') return; // Already set up or active

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(mediaStream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = currentMicBoostLevel;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256; // Smaller FFT size for faster updates, good for level visualization

        source.connect(gainNode);
        gainNode.connect(analyser);
        // The gainNode will be connected to a MediaStreamDestination when recording starts.
        // The analyser is connected to gainNode to monitor input level.

        gainNodeRef.current = gainNode;
        analyserRef.current = analyser;
    }, [mediaStream, currentMicBoostLevel]);

    const cleanupAudio = useCallback(() => {
        if (animationFrameIdRef.current) {
            cancelAnimationFrame(animationFrameIdRef.current);
            animationFrameIdRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(e => console.error("Error closing AudioContext:", e));
            audioContextRef.current = null;
        }
        recordedChunksRef.current = [];
        setPlaybackAudioBlob(null);
        setIsTesting(false);
        setIsPlaybackActive(false);
    }, []);

    // Initialize and clean up audio context/nodes
    useEffect(() => {
        setupAudio();
        return () => cleanupAudio();
    }, [setupAudio, cleanupAudio]);

    // --- Recording Logic for running microphone test ---
    const startTestRecording = useCallback(() => {
        if (!mediaStream || !audioContextRef.current || !gainNodeRef.current || mediaRecorderRef.current?.state === 'recording') {
            console.warn("Audio components not ready or already recording for test.");
            return;
        }

        // Create a new MediaStreamDestination to capture the processed audio
        const destination = audioContextRef.current.createMediaStreamDestination();
        gainNodeRef.current.connect(destination); // Connect the gain node output to the recorder's input

        const mediaRecorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm' }); // Use webm for broader browser support
        mediaRecorderRef.current = mediaRecorder;
        recordedChunksRef.current = [];
        setIsTesting(true);
        setPlaybackAudioBlob(null); // Clear previous recording

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            console.log("Test recording stopped. Chunks:", recordedChunksRef.current.length);
            // Disconnect the gain node from the destination after recording stops
            if (gainNodeRef.current && destination) {
                gainNodeRef.current.disconnect(destination);
            }
            if (recordedChunksRef.current.length > 0) {
                const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
                setPlaybackAudioBlob(blob);
            }
            setIsTesting(false); // Recording has finished
        };

        try {
            mediaRecorder.start();
            recordingStartTimeRef.current = Date.now();
            console.log("Test recording started.");
        } catch (error) {
            console.error("Error starting test recording:", error);
            setIsTesting(false); // Reset state on error
        }
    }, [mediaStream]);

    const stopTestRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            console.log("Stopping test recording.");
        }
    }, []);

    // --- Audio Level Monitoring ---
    const checkAudioLevel = useCallback(() => {
        if (!analyserRef.current || !audioContextRef.current || audioContextRef.current.state === 'suspended') {
            animationFrameIdRef.current = requestAnimationFrame(checkAudioLevel); // Keep trying if context is suspended
            return;
        }

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setAudioInputLevel(average / 255); // Normalize for UI (0 to 1)

        // Stop recording if max duration is reached
        if (isTesting && mediaRecorderRef.current?.state === 'recording') {
            const currentTime = Date.now();
            const recordingDuration = recordingStartTimeRef.current ? currentTime - recordingStartTimeRef.current : 0;

            if (recordingDuration >= MAX_TEST_RECORDING_DURATION_MS) {
                console.log("Max test recording duration reached. Stopping.");
                stopTestRecording();
                return; // Stop the animation loop for this frame as we are stopping
            }
        }

        animationFrameIdRef.current = requestAnimationFrame(checkAudioLevel);
    }, [isTesting, stopTestRecording]);

    // Start the audio level check loop when component mounts
    useEffect(() => {
        // Attempt to resume audio context on user interaction if it's suspended
        const resumeContext = () => {
            if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume().then(() => {
                    console.log("AudioContext resumed successfully.");
                }).catch(e => console.error("Error resuming AudioContext:", e));
            }
        };
        // Add event listeners to trigger context resume
        document.addEventListener('click', resumeContext);
        document.addEventListener('keydown', resumeContext);

        animationFrameIdRef.current = requestAnimationFrame(checkAudioLevel);

        return () => {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
            document.removeEventListener('click', resumeContext);
            document.removeEventListener('keydown', resumeContext);
        };
    }, [checkAudioLevel]);

    // --- Playback Logic ---
    const playRecordedAudio = useCallback(() => {
        if (!playbackAudioBlob) {
            console.warn("No audio to play back.");
            return;
        }

        setIsPlaybackActive(true);
        const audioUrl = URL.createObjectURL(playbackAudioBlob);
        const audio = new Audio(audioUrl);

        audio.onended = () => {
            setIsPlaybackActive(false);
            URL.revokeObjectURL(audioUrl); // Clean up the object URL
        };
        audio.onerror = (e) => {
            console.error("Error during audio playback:", e);
            setIsPlaybackActive(false);
            URL.revokeObjectURL(audioUrl);
        };

        audio.play().catch(e => {
            console.error("Error playing audio:", e);
            setIsPlaybackActive(false);
            URL.revokeObjectURL(audioUrl);
        });
    }, [playbackAudioBlob]);

    // --- UI Handlers ---
    const handleMicBoostChange = (event) => {
        const newLevel = parseFloat(event.target.value);
        setCurrentMicBoostLevel(newLevel);
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = newLevel;
        }
    };

    const handleStartStopTest = () => {
        if (isTesting) {
            // If currently recording, stop it
            stopTestRecording();
        } else {
            // Start a new test recording
            startTestRecording();
        }
    };

    const handleSave = () => {
        onSave(currentMicBoostLevel);
        onClose();
    };

    // Helper to determine the color of the audio level bar
    const getLevelBarColorClass = (level) => {
        if (level > 0.7) return 'level-high';
        if (level > 0.4) return 'level-medium';
        return 'level-low';
    };

    return (
        <div className="mic-test-overlay">
            <div className="mic-test-modal">
                <h2>Microphone Test</h2>

                <div className="mic-test-form-group">
                    <label htmlFor="micBoost" className="mic-test-label">Microphone amplification level</label>
                    <select
                        id="micBoost"
                        value={currentMicBoostLevel}
                        onChange={handleMicBoostChange}
                        className="mic-test-select"
                        disabled={isTesting || isPlaybackActive}
                    >
                        {DEFAULT_BOOST_OPTIONS.map(level => (<option key={level} value={level}>{level}x</option>))}
                    </select>
                </div>

                <div className="mic-test-level-container">
                    <p>Input Level: {Math.round(audioInputLevel * 100)}%</p>
                    <div className="mic-test-level-bar-bg">
                        <div
                            className={`mic-test-level-bar-fg ${getLevelBarColorClass(audioInputLevel)}`}
                            style={{ width: `${audioInputLevel * 100}%` }}
                        ></div>
                    </div>
                </div>

                <div className="mic-test-button-container">
                    <div className="mic-test-button-group">
                        <button className="btn-small" onClick={handleStartStopTest} disabled={isPlaybackActive}>
                            {isTesting ? "Stop Test" : "Start Test"}
                        </button>
                        <button className="btn-small" onClick={playRecordedAudio} disabled={!playbackAudioBlob || isTesting || isPlaybackActive}>
                            Play Back
                        </button>
                    </div>
                    <div className="mic-test-button-group">
                        <button className="btn-small" onClick={handleSave} disabled={isTesting || isPlaybackActive}>Save & Close</button>
                        <button className="btn-small" onClick={onClose} disabled={isTesting || isPlaybackActive}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MicTestOverlay;
