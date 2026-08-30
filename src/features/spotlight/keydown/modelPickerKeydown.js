// Keyboard grammar for /model — filters the same list ModelPickerPanel
// renders, so the filtered index math here must match its own filter exactly.
export function handleModelPickerKeydown(e, {
    query, availableModels, selectedIndex, setSelectedIndex,
    handleModelSelect, handleClose, setCommandMode, setQuery,
}) {
    const filterQuery = query.replace(/^\/model\s*/i, '').trim().toLowerCase();
    const filteredModels = availableModels.filter(m =>
        !m.disabled && m.title.toLowerCase().includes(filterQuery)
    );

    if (e.key === 'ArrowDown' && filteredModels.length > 0) {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredModels.length);
        return;
    }
    if (e.key === 'ArrowUp' && filteredModels.length > 0) {
        e.preventDefault();
        setSelectedIndex(prev => prev <= 0 ? filteredModels.length - 1 : prev - 1);
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        const modelToLoad = selectedIndex >= 0 ? filteredModels[selectedIndex] : filteredModels[0];
        if (modelToLoad && !modelToLoad.disabled && !modelToLoad.isLoaded) {
            handleModelSelect(modelToLoad.name);
        } else if (modelToLoad?.isLoaded) {
            handleClose(); // Already loaded, just close
        }
        return;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        setCommandMode(null);
        setQuery('');
    }
}
