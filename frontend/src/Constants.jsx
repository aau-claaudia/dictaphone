/**
 * Represents the finalization status of a recording.
 * This is a JavaScript mirror of the Python RecordingStatus Enum from the server.
 * Using Object.freeze() makes the object immutable, preventing accidental changes.
 */
export const RecordingStatus = Object.freeze({
    VERIFIED: 1,                 // Normal completion
    INTERRUPTED_VERIFIED: 2,     // Recording was stopped by disconnect, but received data is okay (no detection of missing chunks)
    DATA_LOSS: 3,                // For when finalization fails due to missing data, e.g. a chunk is missing
    INTERRUPTED_NOT_VERIFIED: 4, // Recording was stopped because of server disconnect, and could not be finalized
});
