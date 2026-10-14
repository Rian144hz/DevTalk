// Mockup helpers: shared sidebar, theme switch and screen-state switch. Not app code.
const ICONS = {
  Home: '<path d="M2.5 7.2 8 2.5l5.5 4.7V13.5h-11z"/><path d="M6.5 13.5v-4h3v4"/>',
  Practice: '<path d="M3 13l1.2-3.6L11 2.6l2.4 2.4-6.8 6.8z"/><path d="M9.6 4l2.4 2.4"/>',
  Review: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 6.5h6M5 9.5h4"/>',
  People: '<circle cx="6" cy="6" r="2.4"/><path d="M2 13c.5-2.4 2-3.4 4-3.4s3.5 1 4 3.4M10.8 3.8a2.2 2.2 0 0 1 0 4.4M12.6 13c-.2-1.4-.8-2.3-1.6-2.8"/>',
  Rooms: '<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/>',
  Progress: '<path d="M2.5 13.5h11M4.5 11V8.5M8 11V4.5M11.5 11V6.5"/>',
  Settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"/>',
};
const NAV = [
  ['Home', 'home.html', ''],
  ['Practice', 'feedback.html', ''],
  ['Review', '#', '<span class="count num">6<span class="visually-hidden"> due</span></span>'],
  ['People', '#', '<span class="later">Later</span>'],
  ['Rooms', 'room.html', ''],
  ['Progress', '#', ''],
  ['Settings', '#', ''],
];

function renderRail(active) {
  const rail = document.querySelector('.rail');
  if (!rail) return;
  const items = NAV.map(([name, href, extra]) =>
    `<li><a href="${href}"${name === active ? ' aria-current="page"' : ''}>` +
    `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>${name}${extra}</a></li>`).join('');
  rail.innerHTML =
    `<div class="brand"><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5 11.2 4.3l1.5 1.5L4.5 14H3z"/><path d="M10 5.5l1.5 1.5"/></svg>DevTalk</div>` +
    `<button class="jump" type="button" aria-label="Search or jump to, Control K">Search or jump to… <kbd>Ctrl K</kbd></button>` +
    `<nav aria-label="Main"><ul class="nav">${items}</ul></nav>` +
    `<p class="rail-foot">Coach: Claude Opus 5.5</p>`;
}

function mockBar(states) {
  const bar = document.createElement('div');
  bar.className = 'mock-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Mockup controls');
  let html = '<span>Theme</span><button data-theme-set="dark" aria-pressed="true">Dark</button><button data-theme-set="light" aria-pressed="false">Light</button>';
  if (states) html += '<span>State</span>' + states.map((s, i) => `<button data-state-set="${s}" aria-pressed="${i === 0}">${s}</button>`).join('');
  bar.innerHTML = html;
  document.body.append(bar);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.themeSet) {
      document.documentElement.dataset.theme = b.dataset.themeSet;
      bar.querySelectorAll('[data-theme-set]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }
    if (b.dataset.stateSet) {
      document.body.dataset.state = b.dataset.stateSet;
      bar.querySelectorAll('[data-state-set]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }
  });
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) bar.querySelector(`[data-theme-set="${q.get('theme')}"]`)?.click();
  if (q.get('state')) bar.querySelector(`[data-state-set="${q.get('state')}"]`)?.click();
}

renderRail(document.body.dataset.active);
mockBar(document.body.dataset.states ? document.body.dataset.states.split(',') : null);
