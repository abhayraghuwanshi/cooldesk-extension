document.getElementById('openDashboard').addEventListener('click', () => {
    console.log('Dashboard button clicked, sending message to background script.');
    chrome.runtime.sendMessage({ action: 'syncAndOpenDashboard' });
});
