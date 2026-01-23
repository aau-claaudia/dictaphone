import React, {useEffect, useState} from 'react';
import './EditTitleOverlay.css';
import './OverlayInteractive.css';
import RecordingInfo from "./RecordingInfo.jsx";

const EditTitleOverlay = ({ editingIndex, sectionsRef, renameTitle, cancelEditTitle }) => {
    const [titleValue, setTitleValue] = useState(null);
    const [infoText, setInfoText] = useState(null);
    const [lastSavedTitle, setLastSavedTitle] = useState(null);
    const [renamingInProgress, setRenamingInProgress] = useState(false);
    const [audioUrl, setAudioUrl] = useState(null);

    useEffect(() => {
        // Initialize data from sections property on component load
        const updatedSections = [...sectionsRef.current];
        const sectionToUpdate = updatedSections[editingIndex];
        const currentTitleValue = sectionToUpdate.title;
        if (currentTitleValue) {
            setTitleValue(currentTitleValue);
        } else {
            console.warn("No default title data for editing.");
            setTitleValue("");
        }
        const lastSaved = sectionToUpdate.lastSavedTitle;
        if (lastSaved)
        {
            setLastSavedTitle(lastSaved);
        } else {
            console.warn("No lastSavedTitle.");
            setLastSavedTitle("");
        }
        setAudioUrl(sectionToUpdate.audioUrl);
    }, []);

    const handleSaveTitle = () => {
        if (validateTitle()) {
            setRenamingInProgress(true);
            setInfoText("Renaming in progress...");
            renameTitle(editingIndex, titleValue.trim());
        }
    };

    const handleCancelEditTitle = () => {
        cancelEditTitle();
    };

    const handleTitleValueChange = (e) => {
        const value = e.target.value.replace(/[^a-zA-Z0-9ÆæØøÅå_ ]/g, ""); // Remove special characters
        setTitleValue(value);
    };

    const validateTitle = () => {
        // Check for empty title
        if (titleValue.trim() === "") {
            setInfoText("The title cannot be empty.");
            return false;
        }
        // Check for same title
        if (titleValue.trim() === lastSavedTitle) {
            setInfoText("The title has not been changed.");
            return false;
        }

        // Check for duplicate title
        const isDuplicate = [...sectionsRef.current].some((section, i) => i !== editingIndex && section.title.trim() === titleValue.trim());
        if (isDuplicate) {
            setInfoText(`Title name \`${titleValue.trim()}\` already exists.`);
            return false;
        }
        return true;
    }

    return (
        <div className="interactive-overlay">
            <div className="interactive-modal-overlay">
                <h2>Edit title</h2>
                <RecordingInfo
                    audioUrl={audioUrl}
                    lastSavedTitle={lastSavedTitle}
                />
                <input
                    type="text"
                    className="edit-title-input"
                    value={titleValue ? titleValue.toString() : ""}
                    onChange={(e) => handleTitleValueChange(e)}
                    maxLength="30"
                    disabled={renamingInProgress}
                    autoFocus
                />
                <div className="edit-actions">
                    <button className="btn-small"
                            onClick={handleSaveTitle}
                            title="Rename the title"
                            disabled={renamingInProgress}
                    >
                        Save
                    </button>
                    <button className="btn-small"
                            onClick={handleCancelEditTitle}
                            title="Close and go back"
                            disabled={renamingInProgress}
                    >
                        Close
                    </button>
                </div>
                {
                    infoText && (
                        <div className="info-text">
                            {infoText}
                        </div>
                    )
                }
                {
                    renamingInProgress && (
                        <div className="loader"/>
                    )
                }
            </div>
        </div>
    );
};

export default EditTitleOverlay;
