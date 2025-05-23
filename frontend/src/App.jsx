import React, {useCallback, useEffect, useRef, useState} from "react";
import {csrfToken} from "./csrf.js";
import { MediaRecorder, register } from 'extendable-media-recorder';
import { connect } from 'extendable-media-recorder-wav-encoder';

await register(await connect());

const App = () => {
    const [recording, setRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [requestIds, setRequestIds] = useState([]); // Store request IDs
    const requestIdsRef = useRef(requestIds);
    const [transcriptions, setTranscriptions] = useState([]); // Store transcriptions
    // Keep the ref updated with the latest requestIds object
    useEffect(() => {
        requestIdsRef.current = requestIds;
    }, [requestIds]);

    //TODO: load relevant state from session

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

                    //TODO: use chunks of 5 seconds - check with tool or script if silence in audio to filter + remove silence
                    //can use this https://github.com/openai/openai-cookbook/blob/main/examples/Whisper_processing_guide.ipynb
                    //to trim leading silence, and maybe something like if trim_ms >= len(sound) and .. how does sound[] work

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
                            console.log(queueRequestData);
                            // Add the request ID to the state
                            setRequestIds((prevIds) => [...prevIds, queueRequestData.request_id]);
                        }
                    } catch (e) {
                        // Handle network errors
                        console.debug("Error sending audio data to backend: " + e);
                    }
                }
            };
            // TODO: fitting interval?
            recorder.start(10000); // Emit data every 10 seconds
            setMediaRecorder(recorder);
            setRecording(true);
        } catch (error) {
            console.error("Error accessing microphone:", error);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder) {
            mediaRecorder.stop();
            setRecording(false);
        }
    };

    // Polling function to fetch transcriptions
    useEffect(() => {
        console.log("use effect triggered...")
        console.log(requestIds)
        requestIds.length > 0 ? setTimeout(() => pollTranscriptions(requestIdsRef.current), 15000) : console.log("No transcription request ids to poll.")
    }, [requestIds]);

    // Function to poll the server for transcription texts
    const pollTranscriptions = useCallback((requestIds) => {
        // TODO: implement functionality to ensure the transcription text chunks are shown in correct order
        // TODO: bundle ids so we don't make a large number of requests, one for each text chunk, in stead request text from all remaining chunks and then order
        // TODO: løsning, i stedet for en for-løkke sendes et json object med de id'er der ønskes - view osv. skal tilpasses så der gives et JSON object tilbage med dem der mangler
        console.debug("Running poll method with requestIds: " + requestIds)

        for (const requestId of requestIds) {
            fetch(`http://localhost:8000/get-transcription/${requestId}/`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "X-CSRFToken": csrfToken,
                },
            })
                .then(response => response.json())
                .then(data => {
                    // debug logging the data returned from the server
                    console.debug('RequestId data: ', data);
                    if (data.transcription) {
                        console.debug("Setting transcription text for requestId: " + requestId)
                        // Add the transcription to the state
                        setTranscriptions((prev) => [...prev, data.transcription]);

                        // Remove the request ID from the polling list
                        setRequestIds((prevIds) =>
                            prevIds.filter((id) => id !== requestId)
                        );
                    } else {
                       console.debug("Transcription text not ready for requestId: " + requestId)
                    }
                })
                .catch(error => {
                    console.error('Error polling backend:', error);
                });
        }
        if (requestIds.length > 0) {
            console.debug("Scheduling poll for transcription texts.")
            setTimeout(() => pollTranscriptions(requestIdsRef.current), 15000);
        }
    }, [requestIds]);

    return (
        <div>
            <h1>Dictaphone prototype</h1>
            <button onClick={startRecording} disabled={recording}>
                Start Recording
            </button>
            <button onClick={stopRecording} disabled={!recording}>
                Stop Recording
            </button>
            <textarea
                readOnly
                value={transcriptions.join("\n")}
                style={{width: "100%", height: "200px", marginTop: "20px"}}
            />
        </div>
    );
};

export default App;