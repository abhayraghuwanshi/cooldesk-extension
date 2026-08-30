import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// /model — pick which local LLM to load. Filtered against whatever's typed
// after "/model " so far, same way every other spotlight mode narrows on query.
export function ModelPickerPanel({ isModelLoading, availableModels, query, selectedIndex, setSelectedIndex, loadModel }) {
    return (
        <div className="spotlight-model-mode">
            <div className="spotlight-model-header">
                <FontAwesomeIcon icon={faRobot} style={{ color: '#A78BFA' }} />
                <span>Select AI Model</span>
                {isModelLoading && (
                    <div style={{ width: 14, height: 14, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
                )}
            </div>
            <div className="spotlight-model-list">
                {availableModels.length === 0 && (
                    <div className="spotlight-model-loading">
                        <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <span>Loading models...</span>
                    </div>
                )}
                {availableModels
                    .filter(m => {
                        const filterQuery = query.replace(/^\/model\s*/i, '').trim().toLowerCase();
                        return m.title.toLowerCase().includes(filterQuery);
                    })
                    .map((model, idx) => (
                        <div
                            key={model.name}
                            className={`spotlight-model-item ${idx === selectedIndex ? 'selected' : ''} ${model.isLoaded ? 'loaded' : ''} ${model.disabled ? 'disabled' : ''} ${isModelLoading ? 'loading' : ''}`}
                            onClick={() => !model.disabled && !model.isLoaded && !isModelLoading && loadModel(model.name)}
                            onMouseEnter={() => setSelectedIndex(idx)}
                        >
                            <div className="model-icon">
                                {isModelLoading && idx === selectedIndex ? (
                                    <div style={{ width: 18, height: 18, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                ) : (
                                    <FontAwesomeIcon icon={faRobot} />
                                )}
                            </div>
                            <div className="model-info">
                                <span className="model-title">{model.title}</span>
                                <span className="model-desc">{model.description}</span>
                            </div>
                            {model.isLoaded && <span className="model-badge">Active</span>}
                        </div>
                    ))}
            </div>
        </div>
    );
}
