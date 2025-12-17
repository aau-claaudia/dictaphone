import React, { useState, useRef, useEffect, useCallback } from 'react';

// Constants for speech detection (tune these as needed)
const SPEECH_THRESHOLD = 20; // Average frequency data value (0-255) to consider as speech
const SILENCE_THRESHOLD = 10; // Average frequency data value (0-255) to consider as silence
const SPEECH_START_DELAY_MS = 500; // How long speech must be detected before starting recording
const SILENCE_STOP_DELAY_MS = 1000; // How long silence must be detected before stopping recording
const MAX_TEST_RECORDING_DURATION_MS = 10000; // Max duration for a single test recording (10 seconds)
const DEFAULT_BOOST_OPTIONS = [1, 2, 3, 5, 10, 20];

// TODO: handle mic access error - see initiateRecording
const MicTestOverlay = ({ mediaStream, initialMicBoostLevel, onSave, onClose }) => {
    const [isTesting, setIsTesting] = useState(false); // True when listening for speech/recording
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
    const isSpeakingRef = useRef(false); // Internal state for speech detection
    const speechTimeoutRef = useRef(null);
    const silenceTimeoutRef = useRef(null);
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
        clearTimeout(speechTimeoutRef.current);
        clearTimeout(silenceTimeoutRef.current);
        isSpeakingRef.current = false;
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

    // --- Recording Logic for Test ---
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
            setIsTesting(false);
        }
    }, [mediaStream]);

    const stopTestRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            console.log("Explicitly stopping test recording.");
        }
        clearTimeout(speechTimeoutRef.current);
        clearTimeout(silenceTimeoutRef.current);
        speechTimeoutRef.current = null;
        silenceTimeoutRef.current = null;
        isSpeakingRef.current = false;
    }, []);

    // --- Audio Level Monitoring and Speech Detection ---
    const checkAudioLevel = useCallback(() => {
        if (!analyserRef.current || !audioContextRef.current || audioContextRef.current.state === 'suspended') {
            animationFrameIdRef.current = requestAnimationFrame(checkAudioLevel); // Keep trying if context is suspended
            return;
        }

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setAudioInputLevel(average / 255); // Normalize for UI (0 to 1)

        // Speech detection logic only if we are in the 'testing' phase (listening for speech)
        if (isTesting) {
            const currentTime = Date.now();
            const recordingDuration = recordingStartTimeRef.current ? currentTime - recordingStartTimeRef.current : 0;

            // Stop recording if max duration is reached
            if (mediaRecorderRef.current?.state === 'recording' && recordingDuration >= MAX_TEST_RECORDING_DURATION_MS) {
                console.log("Max test recording duration reached. Stopping.");
                stopTestRecording();
                return; // Stop further processing for this frame
            }

            if (average > SPEECH_THRESHOLD) {
                clearTimeout(silenceTimeoutRef.current);
                silenceTimeoutRef.current = null;

                if (!isSpeakingRef.current && mediaRecorderRef.current?.state !== 'recording') {
                    if (!speechTimeoutRef.current) {
                        speechTimeoutRef.current = setTimeout(() => {
                            isSpeakingRef.current = true;
                            console.log("Speech confirmed, starting recording.");
                            startTestRecording(); // Start recording when speech is confirmed
                        }, SPEECH_START_DELAY_MS);
                    }
                }
            } else if (average < SILENCE_THRESHOLD) {
                clearTimeout(speechTimeoutRef.current);
                speechTimeoutRef.current = null;

                if (isSpeakingRef.current && mediaRecorderRef.current?.state === 'recording') {
                    if (!silenceTimeoutRef.current) {
                        silenceTimeoutRef.current = setTimeout(() => {
                            isSpeakingRef.current = false;
                            console.log("Silence confirmed, stopping recording.");
                            stopTestRecording(); // Stop recording when silence is confirmed
                        }, SILENCE_STOP_DELAY_MS);
                    }
                }
            }
        }

        animationFrameIdRef.current = requestAnimationFrame(checkAudioLevel);
    }, [isTesting, startTestRecording, stopTestRecording]);

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
            clearTimeout(speechTimeoutRef.current);
            clearTimeout(silenceTimeoutRef.current);
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
            // If currently listening/recording, stop everything
            stopTestRecording();
            setIsTesting(false); // Reset state
        } else {
            // Reset state for a new test session
            recordedChunksRef.current = [];
            setPlaybackAudioBlob(null);
            isSpeakingRef.current = false;
            clearTimeout(speechTimeoutRef.current);
            clearTimeout(silenceTimeoutRef.current);
            speechTimeoutRef.current = null;
            silenceTimeoutRef.current = null;

            setIsTesting(true); // Indicate that we are now actively listening for speech
            console.log("Listening for speech to start test recording...");
        }
    };

    const handleSave = () => {
        onSave(currentMicBoostLevel);
        onClose();
    };

    // TODO: extract styling to MicTestOverlay.CSS - make sure zIndex is 500 (error overlay is 1000)

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 500
        }}>
            <div style={{
                backgroundColor: 'white', padding: '20px', borderRadius: '8px',
                width: '400px', boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
            }}>
                <h2>Microphone Test</h2>

                <div>
                    <label htmlFor="micBoost" style={{display: 'block', marginBottom: '5px'}}>Microphone amplification
                        level</label>
                    <select
                        id="micBoost"
                        value={currentMicBoostLevel}
                        onChange={handleMicBoostChange}
                        style={{width: '100%', padding: '8px', borderRadius: '4px'}}
                        disabled={isTesting || isPlaybackActive}
                    >
                    {DEFAULT_BOOST_OPTIONS.map(level => (
                        <option key={level} value={level}>
                            {level}x
                        </option>
                    ))}
                    </select>
                </div>

            <div style={{marginTop: '15px'}}>
                <p>Input Level: {Math.round(audioInputLevel * 100)}%</p>
                <div style={{
                    height: '10px', backgroundColor: '#eee', borderRadius: '5px',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        width: `${audioInputLevel * 100}%`, height: '100%',
                        backgroundColor: audioInputLevel > 0.7 ? 'red' : (audioInputLevel > 0.4 ? 'orange' : 'green')
                    }}></div>
                </div>
            </div>

            <div style={{marginTop: '20px', display: 'flex', gap: '10px'}}>
                <button onClick={handleStartStopTest} disabled={isPlaybackActive}>
                    {isTesting ? "Stop Test" : "Start Test"}
                </button>
                <button onClick={playRecordedAudio} disabled={!playbackAudioBlob || isTesting || isPlaybackActive}>
                        Play Back
                    </button>
                </div>

                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button onClick={handleSave} disabled={isTesting || isPlaybackActive}>Save & Close</button>
                    <button onClick={onClose} disabled={isTesting || isPlaybackActive}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default MicTestOverlay;
