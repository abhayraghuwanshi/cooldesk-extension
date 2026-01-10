import annyang from 'annyang';
import { VoiceCommandProcessor } from '../services/voiceCommandProcessor.js';

// Initialize response handling
const handleFeedback = (message, type = 'success') => {
    // Forward feedback to the background script, which will send it to the active tab/footer
    chrome.runtime.sendMessage({
        type: 'VOICE_FEEDBACK',
        message,
        feedbackType: type
    });
};

// Initialize Command Processor
const commandProcessor = new VoiceCommandProcessor(handleFeedback);

// Handle commands from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_VOICE') {
        try {
            startListening();
            sendResponse({ success: true });
        } catch (e) {
            sendResponse({ success: false, error: e.message || 'Permission denied or error' });
        }
    } else if (msg.type === 'STOP_VOICE') {
        stopListening();
        sendResponse({ success: true });
    } else if (msg.type === 'CHECK_STATUS') {
        sendResponse({ isListening: annyang && annyang.isListening() });
    }
    // Return true if we were to respond asynchronously, but here we don't need to.
});

// Configure Annyang
if (annyang) {
    // Define catch-all command handler
    // Since we want to process natural language, we might need a catch-all
    // but annyang works best with defined commands.
    // However, VoiceCommandProcessor checks for includes.
    // Let's define a splice approach or just standard commands.

    // Actually, VoiceCommandProcessor is designed to take a full string.
    // We can use the result callback to get the full transcript.

    annyang.addCallback('result', (phrases) => {
        const transcript = phrases[0];
        console.log('[Offscreen] Heard:', transcript);

        // Send transcript updates
        chrome.runtime.sendMessage({
            type: 'VOICE_TRANSCRIPT',
            transcript: transcript
        });

        // Process the command
        commandProcessor.processVoiceCommand(transcript);
    });

    annyang.addCallback('start', () => {
        console.log('[Offscreen] Annyang started');
        chrome.runtime.sendMessage({ type: 'VOICE_STATE_CHANGE', isListening: true });
    });

    annyang.addCallback('end', () => {
        console.log('[Offscreen] Annyang ended');
        chrome.runtime.sendMessage({ type: 'VOICE_STATE_CHANGE', isListening: false });
    });

    annyang.addCallback('error', (err) => {
        console.error('[Offscreen] Annyang error:', err);
        chrome.runtime.sendMessage({
            type: 'VOICE_ERROR',
            error: err.error || 'Unknown error'
        });
    });
}

function startListening() {
    if (annyang) {
        try {
            // checking if audio processing is allowed isn't direct, but start() might throw
            annyang.start({ autoRestart: true, continuous: true });
        } catch (e) {
            console.error('[Offscreen] Failed to start annyang:', e);
            throw e;
        }
    } else {
        console.error('[Offscreen] Annyang not loaded');
        throw new Error('Annyang not loaded');
    }
}

function stopListening() {
    if (annyang) {
        annyang.abort();
    }
}
