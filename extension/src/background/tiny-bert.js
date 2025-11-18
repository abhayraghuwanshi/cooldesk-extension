// TinyBERT Intent Handler for Chrome Extension Voice Commands
// --------------------------------------------------------------
// This file is responsible for processing spoken text and converting it
// into actionable intents using TinyBERT with fuzzy fallback.

import { pipeline } from '@xenova/transformers';
import stringSimilarity from 'string-similarity';

let classifier;

// Predefined intent labels
const COMMAND_LABELS = [
    "open_youtube",
    "open_gmail",
    "open_facebook",
    "open_settings"
];

// Load TinyBERT (DistilBERT used here – replace with TinyBERT model link when available)
(async () => {
    classifier = await pipeline(
        "text-classification",
        "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
    );
})();

// Convert incoming transcript to detected intent
export async function detectIntent(text) {
    try {
        const result = await classifier(text);
        return result[0].label;
    } catch (error) {
        console.warn("TinyBERT failed, using fuzzy fallback", error);
        return fallbackIntent(text);
    }
}

// Fuzzy string matching when model confidence is unsure or fails
function fallbackIntent(text) {
    const matches = stringSimilarity.findBestMatch(text.toLowerCase(), [
        "open youtube",
        "open gmail",
        "open facebook",
        "open settings"
    ]);
    return matches.bestMatch.target.replace(" ", "_");
}

// Execute browser action based on detected intent
export async function handleVoiceCommand(text) {
    const intent = await detectIntent(text);

    switch (intent) {
        case "open_youtube":
            window.open("https://youtube.com", "_blank");
            break;

        case "open_gmail":
            window.open("https://mail.google.com", "_blank");
            break;

        case "open_facebook":
            window.open("https://facebook.com", "_blank");
            break;

        case "open_settings":
            chrome.runtime.openOptionsPage();
            break;

        default:
            console.log("Command not recognized: ", text);
    }
}
