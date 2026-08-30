import { useCallback, useState } from 'react';
import * as LocalAI from '../../services/localAIService';

/**
 * /model — list downloaded local LLMs and load one. Deliberately has no
 * opinion on what happens after a load succeeds (e.g. closing the spotlight)
 * — that's the caller's call to make, and keeping it out of here means this
 * hook never needs to know about anything defined later in the component.
 */
export function useModelPicker() {
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [currentModel, setCurrentModel] = useState(null);

    const fetchAvailableModels = useCallback(async () => {
        try {
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
                setAvailableModels([{
                    name: 'error',
                    title: 'Desktop App Not Running',
                    description: 'Please start the CoolDesk desktop app to use AI',
                    disabled: true
                }]);
                return;
            }

            const status = await LocalAI.getStatus();
            setCurrentModel(status.currentModel || null);

            const modelsResult = await LocalAI.getModels();
            const modelFilenames = Object.keys(modelsResult || {}).filter(
                name => modelsResult[name]?.downloaded
            );

            if (modelFilenames.length === 0) {
                setAvailableModels([{
                    name: 'error',
                    title: 'No Models Downloaded',
                    description: 'Go to Settings → Local AI to download models',
                    disabled: true
                }]);
                return;
            }

            const models = modelFilenames.map(name => {
                const modelInfo = modelsResult[name];
                const isLoaded = status.currentModel === name;
                return {
                    name,
                    title: modelInfo?.displayName || name,
                    description: isLoaded ? '✓ Currently loaded' : `Click to load • ${modelInfo?.size || ''}`,
                    isLoaded,
                    disabled: false
                };
            }).sort((a, b) => {
                if (a.isLoaded && !b.isLoaded) return -1;
                if (!a.isLoaded && b.isLoaded) return 1;
                return 0;
            });

            setAvailableModels(models);
        } catch (error) {
            console.error('[Spotlight] Failed to fetch models:', error);
            setAvailableModels([{
                name: 'error',
                title: 'Error Loading Models',
                description: error.message || 'Failed to connect to AI service',
                disabled: true
            }]);
        }
    }, []);

    // Resolves to whether the load actually succeeded — callers that want to
    // do something (like closing the spotlight) only on success need this,
    // since failures are already logged and swallowed here.
    const loadModel = useCallback(async (modelName) => {
        if (isModelLoading) return false;

        try {
            setIsModelLoading(true);
            await LocalAI.loadModel(modelName);
            setCurrentModel(modelName);
            // Refresh the list
            await fetchAvailableModels();
            return true;
        } catch (error) {
            console.error('[Spotlight] Failed to load model:', error);
            return false;
        } finally {
            setIsModelLoading(false);
        }
    }, [isModelLoading, fetchAvailableModels]);

    return { isModelLoading, availableModels, currentModel, fetchAvailableModels, loadModel };
}
