document.addEventListener('DOMContentLoaded', () => {
  const urlBox = document.getElementById('target-url');
  const launchBtn = document.getElementById('launch-btn');
  let currentTabUrl = '';

  // Get active tab URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      const url = tabs[0].url;
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        currentTabUrl = url;
        urlBox.textContent = url;
        urlBox.setAttribute('title', url);
      } else {
        urlBox.textContent = 'Navigate to a web page';
        urlBox.style.color = '#ef4444';
      }
    }
  });

  const standardActions = document.getElementById('standard-actions');
  const sessionActions = document.getElementById('session-actions');
  const resumeBtn = document.getElementById('resume-btn');
  const newSessionBtn = document.getElementById('new-session-btn');
  const dashboardPageUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');

  // Query tabs to see if dashboard is already open
  chrome.tabs.query({}, (tabs) => {
    const existingDashboard = tabs.find(tab => tab.url && tab.url.startsWith(dashboardPageUrl));
    
    if (existingDashboard) {
      // Show session resume controls
      standardActions.style.display = 'none';
      sessionActions.style.display = 'flex';
      
      // Bind resume button
      resumeBtn.addEventListener('click', () => {
        chrome.tabs.update(existingDashboard.id, { active: true });
        chrome.windows.update(existingDashboard.windowId, { focused: true });
        window.close();
      });
      
      // Bind open new session button
      newSessionBtn.addEventListener('click', () => {
        let dashboardUrl = dashboardPageUrl;
        if (currentTabUrl) {
          dashboardUrl += `?url=${encodeURIComponent(currentTabUrl)}`;
        }
        chrome.tabs.create({ url: dashboardUrl });
        window.close();
      });
    } else {
      // Show standard launch controls
      standardActions.style.display = 'block';
      sessionActions.style.display = 'none';
      
      // Bind standard launch button
      launchBtn.addEventListener('click', () => {
        let dashboardUrl = dashboardPageUrl;
        if (currentTabUrl) {
          dashboardUrl += `?url=${encodeURIComponent(currentTabUrl)}`;
        }
        chrome.tabs.create({ url: dashboardUrl });
        window.close();
      });
    }
  });
});
