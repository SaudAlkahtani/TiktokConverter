// Close the live connection before leaving so rapid navigation cannot retain it
// in the browser's back/forward cache and exhaust localhost connections.
export function setupNavigation({ nav, window, location, startStream }) {
  let stream = startStream();
  let navigating = false;
  const stop = () => { stream?.close(); stream = null; };
  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.getAttribute('aria-current') === 'page' || navigating) {
      event.preventDefault();
      return;
    }
    navigating = true;
    stop();
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => {
    navigating = false;
    if (!stream) stream = startStream();
  });
}
