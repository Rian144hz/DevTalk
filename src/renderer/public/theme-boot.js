// Runs as a blocking script in <head>, before the first paint, so the very first frame (the launch splash) already has
// the right ground; the app's own bundle loads after the page can first paint. Same rule as lib/theme.ts: the setting
// of the last run ("devtalk.theme": dark, light or system), else the system's. The app sets the theme again once it runs.
(function () {
  var light;
  try {
    var setting = localStorage.getItem('devtalk.theme');
    light = setting === 'light' || (setting !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches);
  } catch (e) {
    try {
      light = window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch (e2) {
      light = false;
    }
  }
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
})();
