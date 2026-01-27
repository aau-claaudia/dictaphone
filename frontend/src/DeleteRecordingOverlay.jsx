import React, {useEffect, useState, useRef, forwardRef, useImperativeHandle} from 'react';
import './OverlayInteractive.css';
import './DeleteRecordingOverlay.css';
import RecordingInfo from "./RecordingInfo.jsx";

const DeleteRecordingOverlay = forwardRef(({ deleteIndex, sectionsRef, deleteRecording, closeDeleteRecording }, ref) => {
    // State for the component's data
    const [title, setTitle] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);

    // State and refs for the hold-to-delete button logic
    const [isHolding, setIsHolding] = useState(false);
    const [isFinished, setIsFinished] = useState(false);
    const [deleteInProgress, setDeleteInProgress] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const timerId = useRef(null); // Use useRef to hold the timer ID across renders
    const HOLD_DURATION_MS = 1500; // Must match --hold-duration in CSS

    useEffect(() => {
        // Initialize data from sections property on component load
        const updatedSections = [...sectionsRef.current];
        const sectionToDelete = updatedSections[deleteIndex];
        setTitle(sectionToDelete.title);
        setAudioUrl(sectionToDelete.audioUrl);

        // This is a cleanup function that React will run when the component unmounts.
        // It's important to clear any running timers to prevent memory leaks.
        return () => {
            if (timerId.current) {
                clearTimeout(timerId.current);
            }
        };
    }, [deleteIndex, sectionsRef]); // Add dependencies to re-run effect if they change

    // Expose a function to the parent component via the ref.
    // This allows the parent to call `deletionCompleted()` after its async operation finishes.
    useImperativeHandle(ref, () => ({
        deletionCompleted: () => {
            setIsFinished(true);
            setDeleteInProgress(false);
        }
    }));

    const handleDeleteRecording = () => {
        setDeleteInProgress(true);
        console.log("Deleting recording...");
        deleteRecording(deleteIndex);
    };

    const handleCloseDeleteRecording = () => {
        closeDeleteRecording();
    };

    const startHold = () => {
        // Don't start a new timer if one is running or the action is done
        if (timerId.current || isFinished) return;

        setIsHolding(true);
        timerId.current = setTimeout(() => {
            handleDeleteRecording();
            timerId.current = null;
        }, HOLD_DURATION_MS);
    };

    const cancelHold = () => {
        // Clear the holding state
        setIsHolding(false);
        // If a timer is running, cancel it
        if (timerId.current) {
            clearTimeout(timerId.current);
            timerId.current = null;
        }
    };

    // Dynamically build the className string based on state
    const buttonClassName = [
        'delete-button',
        isHolding ? 'is-holding' : '',
        isFinished ? 'is-finished' : ''
    ].filter(Boolean).join(' ');

    return (
        <div className="interactive-overlay">
            <div className="interactive-modal-overlay">
                <h2>Delete recording</h2>
                <RecordingInfo audioUrl={audioUrl} lastSavedTitle={title}/>
                <div className="delete-warning">
                    Warning: You are about to permanently delete the recording and all related files.
                </div>
                <div className="edit-actions">
                    <button
                        className={buttonClassName}
                        title="Hold to delete recording"
                        disabled={isFinished || deleteInProgress}
                        // Attach event handlers directly to the button element
                        onMouseDown={startHold}
                        onMouseUp={cancelHold}
                        onMouseEnter={() => setIsHovering(true)}
                        onMouseLeave={() => {
                            setIsHovering(false);
                            cancelHold();
                        }}
                        onTouchStart={(e) => {
                            e.preventDefault();
                            startHold();
                        }}
                        onTouchEnd={cancelHold}
                    >
                        <span className="button-text">
                            {!isFinished && (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path
                                        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            )}
                            {isFinished ? 'Deleted' : (isHovering ? 'Hold to delete' : 'Delete')}
                        </span>
                        <div className="progress-bar"></div>
                    </button>
                    <button
                        className="btn-small-close-from-delete"
                        onClick={handleCloseDeleteRecording}
                        title="Close and go back"
                        disabled={deleteInProgress}
                    >
                        Close
                    </button>
                </div>
                {
                    deleteInProgress && (
                        <div className="loader"/>
                    )
                }
            </div>
        </div>
    );
});

export default DeleteRecordingOverlay;
