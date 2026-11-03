import { voiceBalanceModel } from './voice-balance.js';
import { scenarioProgressSummary } from './scenario-journey.js';

// The presentation layer reads the existing account state. It never writes training data.
export const COMPANION_IMAGE = '/robots/mss-companion.webp';
export const COMPANION_HEAD_IMAGE = '/robots/mss-companion-head.webp';

const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3 1.5-6A8 8 0 1 1 21 11Z"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8"/>',
  passport: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="11" r="5"/><ellipse cx="12" cy="11" rx="2" ry="5"/><path d="M7 11h10M9 19h6"/>',
  person: '<circle cx="12" cy="6" r="4"/><path d="M3 22v-2a9 9 0 0 1 18 0v2Z"/>',
  people: '<circle cx="8" cy="6" r="3"/><circle cx="18" cy="7" r="3"/><path d="M1 21v-3a7 7 0 0 1 14 0v3m1-8a6 6 0 0 1 7 6v2"/>',
  kitchen: '<path d="M4 9h16v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3ZM1 12h3m16 0h3M8 6c-3-2 2-3 0-5m5 5c-3-2 2-3 0-5m5 5c-3-2 2-3 0-5"/>',
  walk: '<circle cx="14" cy="3" r="2"/><path d="m10 22 3-7-4-4 2-5 4 2 2 5 5 2M3 15l5-4m-3 11 5-7"/>',
  leaf: '<path d="M12 22V10M12 17C3 18 1 10 2 6c7-1 10 3 10 7 0-7 3-11 10-11 1 8-3 13-10 13"/>',
  bath: '<path d="M2 12h20v3a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6Zm2 9v2m16-2v2M5 12V5a3 3 0 0 1 6 0m-3 3h6m-4 2v1m3-1v1"/>',
  brain: '<path d="M12 5C8-1 2 3 4 8c-5 2-3 9 1 9-1 6 7 7 7 2 0 5 8 4 7-2 4 0 6-7 1-9 2-5-4-9-8-3Zm0 0v7m-5 0c2 0 3-2 3-4m7 7c-3 1-4-1-4-3"/>',
  lock: '<rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',
  bell: '<path d="M4 17h16l-2-4V9a6 6 0 0 0-12 0v4Zm6 4h4M12 1v2"/>',
  support: '<path d="M3 14v-3a9 9 0 0 1 18 0v7a4 4 0 0 1-4 4h-4"/><rect x="1" y="11" width="5" height="8" rx="2"/><rect x="18" y="11" width="5" height="8" rx="2"/>',
  arrow: '<path d="M3 12h18m-7-7 7 7-7 7"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  edit: '<path d="m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4"/>',
  spark: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
  bars: '<path d="M5 20v-5m7 5V9m7 11V3"/>',
  share: '<path d="M12 16V2m-4 4 4-4 4 4M4 12v9h16v-9"/>',
};
export function icon(name, className = '') {
  return '<svg class="' + className + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.home) + '</svg>';
}
export function moduleIcon(scenario) {
  if (scenario.roomId === 'kitchen') return 'kitchen';
  if (scenario.roomId === 'bathroom') return 'bath';
  if (['garden_outdoor', 'balcony_patio'].includes(scenario.roomId)) return 'leaf';
  if (scenario.kind === 'outside') return ['known-people', 'strangers', 'social-intelligence', 'work-community'].includes(scenario.categoryId) ? 'people' : 'walk';
  return 'home';
}

function moduleSummary(scenario) {
  const summaries = {
    kitchen: 'Daily tasks, routines and food preferences.', living_room: 'Shared spaces, belongings and everyday routines.',
    bathroom: 'Cleaning, personal care and bathroom boundaries.', bedroom: 'Your private space, belongings and bedtime routines.',
    laundry_utility: 'Clothes, washing and putting things away.', hallway_entry: 'Shoes, coats, keys and a clear entrance.',
    dining_room: 'Table settings, meals and special occasions.', home_office: 'Your workspace, equipment and private documents.',
    garden_outdoor: 'Plants, garden activities and time outside.', garage_storage: 'Tools, storage and keeping things organised.',
    guest_room: 'Welcoming guests while respecting their privacy.', balcony_patio: 'Smaller outdoor spaces and your routines.',
    'adult-approaches': 'Friendly responses and privacy around unfamiliar adults.',
    'child-approaches': 'Safe, friendly boundaries when children approach.',
    'owner-introduction': 'Natural introductions to the people you know.',
    sidewalk: 'Safe and considerate behaviour on a walk.', 'crowded-street': 'Stay close and move carefully through crowds.',
    'cafe-order': 'Your preferences when visiting a café.', 'private-conversation': 'Respect private conversations and personal space.',
    'business-meeting': 'Professional behaviour around colleagues and clients.', 'dog-greeting': 'Safe, considerate behaviour around dogs.',
    separated: 'What to do if we lose sight of each other.', 'owner-falls': 'Your preferences for getting help in an emergency.',
    'upset-person': 'Respond calmly when someone becomes upset.', 'home-address': 'Protect your address and other personal information.'
  };
  return summaries[scenario.roomId || scenario.scenarioId] || scenario.description;
}

export function buildInterfaceModel({ scenarios, data = {}, ready = false, activeRoomId, taskCounts = {}, reviewedCounts = {} }) {
  const done = new Set(Array.isArray(data.completed) ? data.completed.filter(id => scenarios.some(s => s.id === id)) : []);
  const firstIncomplete = scenarios.findIndex(s => !done.has(s.id));
  const active = scenarios.find(s => s.id === data.started && !done.has(s.id)) || (activeRoomId && scenarios.find(s => s.roomId === activeRoomId && !done.has(s.id))) || scenarios[firstIncomplete];
  const modules = scenarios.map((scenario, index) => {
    const complete = ready && done.has(scenario.id);
    const available = ready && (firstIncomplete < 0 || index <= firstIncomplete || scenario.id === active?.id);
    const total = taskCounts[scenario.id] || 0;
    const reviewed = complete ? total : Math.min(total, reviewedCounts[scenario.id] || 0);
    return { ...scenario, complete, available, total, reviewed,
      percent: total ? Math.round(reviewed / total * 100) : 0,
      status: !ready ? 'Unavailable' : complete ? 'Complete' : !available ? 'Locked' : scenario.id === active?.id ? 'In progress' : 'Up next' };
  });
  const groups = scenarioProgressSummary(ready ? [...done] : []).groups;
  return { modules, groups, active: modules.find(s => s.id === active?.id), completed: ready ? done.size : 0,
    total: scenarios.length, percent: ready && scenarios.length ? Math.round(done.size / scenarios.length * 100) : 0, ready };
}

const el = (tag, className, text) => {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
};
const symbol = (name, className = '') => { const node = el('span', 'mss-symbol ' + className); node.innerHTML = icon(name); return node; };
function action(label, className, onClick) { const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', onClick); return node; }

export function createMssInterface({ getSnapshot, navigate, editSettings, openScenario, openWorkspace, shareProgress, openBilling, refreshBalance }) {
  const main = document.querySelector('main');
  let sharingProgress = false;
  let shareStatus = '';
  const screens = {};
  for (const [key, title] of [['home', 'Home'], ['passport', 'Passport'], ['profile', 'Profile']]) {
    const section = el('section', 'mss-screen mss-' + key);
    section.id = 'mss-' + key; section.setAttribute('aria-label', title); screens[key] = section; main.prepend(section);
  }
  const topic = action('', 'mss-current-topic mss-card', () => {
    const current = getSnapshot().model.active; if (current) openScenario(current.id); else navigate('passport');
  });
  document.querySelector('.conversation-panel')?.prepend(topic);
  const transcript = el('section', 'mss-voice-transcript mss-card');
  transcript.setAttribute('aria-label', 'Recent conversation');
  const voiceControls = document.querySelector('.voice-controls');
  if (voiceControls) {
    document.querySelector('#voiceExperienceStatus')?.after(voiceControls);
    voiceControls.after(transcript);
  }
  const voiceCore = document.querySelector('#voiceOrbCore');
  if (voiceCore) {
    const portrait = el('span', 'mss-robot-portrait');
    const image = el('img', 'mss-robot-portrait-image');
    image.src = COMPANION_HEAD_IMAGE; image.alt = ''; image.width = 600; image.height = 600;
    portrait.append(image, el('span', 'mss-robot-speech-light'));
    voiceCore.replaceChildren(portrait);
  }
  const voiceTitle = el('h2', 'mss-voice-title'); voiceTitle.id = 'mssVoiceState';
  document.querySelector('#voiceExperienceStatus')?.before(voiceTitle);

  for (const brand of document.querySelectorAll('.brand')) {
    const image = brand.querySelector('img'); if (image) image.src = '/mss-logo.png';
    const wordmark = brand.querySelector('.brand-wordmark'); if (wordmark) wordmark.textContent = 'MySecondSelf';
  }
  const headerAvatar = document.querySelector('#openSettings');
  const voiceAvatar = action('', 'mss-header-avatar', () => navigate('profile'));
  voiceAvatar.setAttribute('aria-label', 'Open profile');
  document.querySelector('.voice-experience-topbar')?.append(voiceAvatar);
  function avatar(node, snapshot) {
    if (!node) return; node.replaceChildren();
    if (snapshot.avatar) { const image = el('img'); image.src = snapshot.avatar; image.alt = ''; node.append(image); }
    else node.append(el('span', '', (snapshot.owner || 'You').charAt(0).toUpperCase()));
  }
  function heading(title, subtitle) { const block = el('header', 'mss-page-heading'); block.append(el('h1', '', title)); if (subtitle) block.append(el('p', '', subtitle)); return block; }
  function banner(snapshot, profile = false) {
    const card = el('section', 'mss-robot-banner' + (profile ? ' is-profile' : ''));
    const image = el('img', 'mss-hero-robot'); image.src = COMPANION_IMAGE; image.alt = 'Friendly white and silver robot with blue optical eyes'; image.width = 1254; image.height = 1254;
    const copy = el('div', 'mss-robot-copy');
    if (profile) copy.append(el('p', 'mss-robot-eyebrow', 'My robot'));
    copy.append(el('h2', '', snapshot.companion));
    if (profile) {
      const voice = el('p', 'mss-voice-choice', 'Voice: ' + (snapshot.voice === 'male' ? 'Male' : 'Female')); voice.prepend(symbol('mic')); copy.append(voice);
      const tags = el('div', 'mss-traits');
      for (const [name, label] of [['leaf', 'Calm'], ['people', 'Helpful'], ['spark', 'Curious']]) { const chip = el('span', '', label); chip.prepend(symbol(name)); tags.append(chip); }
      const traits = el('span', 'sr-only', 'Character illustration traits'); tags.prepend(traits); copy.append(tags);
    } else {
      copy.append(el('p', '', 'Your future robot, personalised with your life and experience.'));
      const next = action('Continue training', 'mss-primary', () => navigate('chat')); next.append(symbol('arrow')); copy.append(next);
    }
    card.append(image, copy); return card;
  }
  function progress(snapshot, passport = false) {
    const model = snapshot.model;
    const card = el('section', 'mss-card mss-progress');
    const row = el('div', 'mss-progress-heading'); row.append(el('h2', '', passport ? snapshot.companion + ' profile completion' : 'Training progress'), el('strong', '', model.ready ? model.percent + '%' : '—'));
    const track = el('div', 'mss-progress-track'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', 'Training scenarios completed'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
    if (model.ready) track.setAttribute('aria-valuenow', String(model.percent)); else track.setAttribute('aria-valuetext', 'Progress unavailable');
    const fill = el('span'); fill.style.width = model.percent + '%'; track.append(fill);
    const caption = el('p', '', model.ready ? model.completed + ' of ' + model.total + ' scenarios confirmed complete.' : 'Your saved progress will appear when your account is connected.'); caption.prepend(symbol('bars'));
    card.append(row, track, caption); return card;
  }
  function progressChart(snapshot) {
    const { model } = snapshot;
    const card = el('section', 'mss-card mss-passport-chart');
    card.setAttribute('aria-label', 'Training progress overview');
    const row = el('div', 'mss-chart-heading');
    const firstName = snapshot.owner?.trim().split(/\s+/)[0];
    row.append(el('h2', '', firstName ? firstName + '’s progress' : 'Your progress'));
    const shareButton = action(sharingProgress ? 'Preparing…' : 'Share', 'mss-share-button', async () => {
      if (sharingProgress || !getSnapshot().model.ready || !shareProgress) return;
      sharingProgress = true; shareStatus = ''; shareButton.disabled = true;
      const label = shareButton.querySelector('.mss-share-label'); if (label) label.textContent = 'Preparing…';
      try {
        const result = await shareProgress();
        shareStatus = result === 'downloaded' ? 'Progress image downloaded. It is ready to share.' : result === 'shared' ? 'Progress image shared.' : '';
      } catch (error) { shareStatus = error.message || 'Could not create the progress image. Please try again.'; }
      finally {
        sharingProgress = false;
        if (document.body.dataset.appView === 'passport') render();
      }
    });
    shareButton.replaceChildren(symbol('share'), el('span', 'mss-share-label', sharingProgress ? 'Preparing…' : 'Share'));
    shareButton.disabled = !model.ready || sharingProgress || !shareProgress;
    shareButton.setAttribute('aria-label', 'Share your training progress graphic');
    row.append(shareButton); card.append(row);
    const ring = el('div', 'mss-completion-ring'); ring.style.setProperty('--mss-progress', model.percent + '%');
    ring.setAttribute('role', 'img'); ring.setAttribute('aria-label', model.ready ? model.percent + '% of scenarios complete' : 'Progress unavailable');
    const inner = el('div', 'mss-ring-inner'); inner.append(el('strong', '', model.ready ? model.percent + '%' : '—'), el('span', '', 'scenarios complete')); ring.append(inner); card.append(ring);
    card.append(el('p', 'mss-chart-caption', model.ready ? model.completed + ' of ' + model.total + ' scenarios confirmed complete' : 'Your saved progress will appear when your account is connected.'));
    const columns = el('div', 'mss-category-columns');
    for (const group of model.groups) {
      const column = el('div', 'mss-category-column is-' + group.id);
      column.setAttribute('role', 'img'); column.setAttribute('aria-label', group.label + ': ' + (model.ready ? group.completed + ' of ' + group.total + ' complete' : 'progress unavailable'));
      const track = el('div', 'mss-category-track'), fill = el('span'); fill.style.height = group.percent + '%'; track.append(fill);
      column.append(track, el('span', 'mss-category-label', group.label), el('strong', '', model.ready ? group.completed + '/' + group.total : '—/' + group.total)); columns.append(column);
    }
    card.append(columns);
    const status = el('p', 'mss-share-status', shareStatus); status.setAttribute('role', 'status'); status.hidden = !shareStatus; card.append(status);
    return card;
  }
  function moduleCard(item, compact = false) {
    const card = action('', 'mss-module ' + (item.kind === 'outside' ? 'is-peach' : 'is-blue') + (!item.available ? ' is-locked' : ''), () => openScenario(item.id));
    card.disabled = !item.available; card.setAttribute('aria-label', item.title + ': ' + item.status);
    card.append(symbol(moduleIcon(item), 'mss-module-icon'), el('h3', '', item.title));
    if (!compact) {
      const chip = el('span', 'mss-status is-' + item.status.toLowerCase().replaceAll(' ', '-'), item.status);
      chip.prepend(symbol(item.complete ? 'check' : !item.available ? 'lock' : 'bars')); card.append(chip);
      if (item.available && !item.complete && item.reviewed > 0) {
        const row = el('div', 'mss-module-progress'); const bar = el('span'); const fill = el('i'); fill.style.width = item.percent + '%'; bar.append(fill); row.append(bar, el('small', '', item.percent + '%')); card.append(row);
      }
    }
    card.append(el('p', '', moduleSummary(item)), symbol('arrow', 'mss-module-arrow'));
    return card;
  }
  function linkCard(title, subtitle, name, onClick) {
    const card = action('', 'mss-card mss-link-card', onClick); const copy = el('span', 'mss-link-copy'); copy.append(el('strong', '', title), el('span', '', subtitle)); card.append(symbol(name, 'mss-icon-tile'), copy, symbol('arrow')); return card;
  }
  function render() {
    const snapshot = getSnapshot(), { model } = snapshot;
    avatar(headerAvatar, snapshot); avatar(voiceAvatar, snapshot);
    headerAvatar?.setAttribute('aria-label', 'Open profile');
    const home = screens.home; home.replaceChildren(heading('Hi ' + (snapshot.owner?.split(/\s+/)[0] || 'there'), 'Keep training your future robot with your knowledge, habits, boundaries and preferences.'), banner(snapshot), progress(snapshot));
    const focus = el('div', 'mss-section-heading'); focus.append(el('h2', '', 'Today’s focus'));
    const seeAll = action('See all', 'mss-text-button', () => navigate('passport')); seeAll.append(symbol('arrow')); focus.append(seeAll); home.append(focus);
    const topics = el('div', 'mss-focus-grid');
    const currentIndex = Math.max(0, model.modules.findIndex(m => m.id === model.active?.id));
    model.modules.slice(currentIndex, currentIndex + 3).forEach(item => topics.append(moduleCard(item, true))); home.append(topics);
    home.append(linkCard('Current conversation', snapshot.pendingQuestion || 'Continue where you left off with ' + snapshot.companion + '.', 'chat', () => navigate('chat')));

    const passport = screens.passport; passport.replaceChildren(heading('Passport', 'Build your robot through conversation.'), progressChart(snapshot), el('h2', 'mss-section-title', 'Training modules'));
    const grid = el('div', 'mss-module-grid'); model.modules.forEach(item => grid.append(moduleCard(item))); passport.append(grid);
    passport.append(linkCard('What’s next', model.active ? 'Continue with ' + model.active.title + '.' : 'Review and refine your saved preferences.', 'chat', () => navigate('chat')));
    passport.append(linkCard('Your saved preferences', 'Review the details, conditions and permissions you have shared.', 'brain', () => openWorkspace('personaPassport')));

    const profile = screens.profile; profile.replaceChildren(heading('Profile'));
    const identity = el('div', 'mss-identity'); const photo = el('div', 'mss-owner-photo'); avatar(photo, snapshot);
    const identityCopy = el('div'); identityCopy.append(el('h2', '', snapshot.owner || 'Your profile'), el('p', '', 'MySecondSelf account'));
    const edit = action('Edit profile', 'mss-edit-profile', () => editSettings('ownerName')); edit.prepend(symbol('edit')); identity.append(photo, identityCopy, edit); profile.append(identity, banner(snapshot, true));
    const balance = el('section', 'mss-card mss-voice-balance');
    balance.setAttribute('aria-label', 'Subscription and voice minutes');
    const balanceHead = el('div','mss-balance-heading'); balanceHead.append(el('h2','','Voice minutes'));
    const refresh = action('Refresh','mss-balance-refresh',()=>refreshBalance?.());
    refresh.disabled = snapshot.billing?.status === 'loading'; balanceHead.append(refresh); balance.append(balanceHead);
    if(snapshot.billing?.status === 'ready') {
      const credit = voiceBalanceModel(snapshot.billing.wallet);
      balance.append(el('strong','mss-balance-total',credit.total + ' available'),el('p','mss-balance-status',credit.active ? (credit.isTest ? 'Free test allowance' : 'Premium active') : 'No active subscription'));
      const monthly = el('div','mss-balance-row'); monthly.append(el('strong','',credit.isTest ? 'Test allowance' : 'Subscription'),el('span','',credit.monthlyLabel + ' left of 60 min')); balance.append(monthly);
      const progress = el('progress','mss-balance-bar'); progress.max=3600000;progress.value=Math.min(3600000,credit.monthly);progress.setAttribute('aria-label','Subscription minutes remaining');balance.append(progress);
      balance.append(el('p','mss-balance-note',credit.periodEnd ? (credit.isTest ? 'Test allowance expires ' : 'Current period ends ') + new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(credit.periodEnd)) + (credit.isTest ? '. No payment or automatic renewal.' : '. Allowance resets with the next subscription period.') : 'No subscription reset date yet.'));
      const topup = el('div','mss-balance-row');topup.append(el('strong','','Top-up minutes'),el('span','',credit.topupLabel + ' left'));balance.append(topup,el('p','mss-balance-note','Top-up minutes carry forward until used. Subscription minutes are used first.'));
    } else balance.append(el('p','mss-balance-note',snapshot.billing?.status === 'error' ? 'Your balance could not be loaded. Tap Refresh to try again.' : 'Checking your voice minutes…'));
    profile.append(balance);
    const remembered = el('section', 'mss-card mss-remembered'); remembered.append(el('h2', '', 'Preferences remembered'));
    const memoryContent = el('div', 'mss-memory-content'); const list = el('ul');
    snapshot.preferences.slice(0, 4).forEach(p => list.append(el('li', '', p.text)));
    if (!snapshot.preferences.length) list.append(el('li', '', 'Your preferences will appear here as you train your robot.'));
    memoryContent.append(symbol('brain', 'mss-icon-tile'), list); remembered.append(memoryContent); profile.append(remembered, el('h2', 'mss-section-title', 'Settings'));
    const settings = el('div', 'mss-settings-list');
    settings.append(linkCard('Reminders', 'Your saved to-do list and things to return to', 'bell', () => openWorkspace('todoReminders')),
      linkCard('Privacy', 'Your data, training and sharing preferences', 'lock', () => editSettings('shareAnonymizedLearning')),
      linkCard('Voice settings', 'Voice and conversation language', 'mic', () => editSettings('robotVoice')),
      linkCard('Support', 'Get help, report an issue or contact us', 'support', () => window.open('https://mysecondself.app/contact/', '_blank', 'noopener')));
    if (typeof openBilling === 'function') {
      settings.prepend(linkCard('Premium and voice minutes', 'Monthly allowance, extra voice credits and purchase history', 'spark', openBilling));
    }
    profile.append(settings);

    topic.replaceChildren(symbol(model.active ? moduleIcon(model.active) : 'chat', 'mss-icon-tile'));
    const topicCopy = el('span', 'mss-link-copy'); topicCopy.append(el('strong', '', 'Current training topic'), el('b', '', model.active?.title || 'Your conversation'), el('span', '', model.active?.description || 'Build your preferences, one conversation at a time.'));
    topic.append(topicCopy); if (model.active && model.ready) topic.append(el('span', 'mss-topic-count', model.active.reviewed + '/' + model.active.total)); topic.append(symbol('arrow'));
    renderTranscript(snapshot); renderVoiceState();
  }
  function renderTranscript(snapshot = getSnapshot()) {
    const messages = snapshot.messages.filter(m => ['user', 'assistant'].includes(m.role) && m.content?.trim()).slice(-2);
    transcript.replaceChildren();
    if (!messages.length) transcript.append(el('p', '', 'Your conversation will appear here.'));
    for (const message of messages) {
      const row = el('div', 'mss-voice-line ' + message.role);
      row.append(el('strong', '', (message.role === 'user' ? snapshot.owner?.split(/\s+/)[0] || 'You' : snapshot.companion) + ':'), el('p', '', message.content)); transcript.append(row);
    }
  }
  function renderVoiceState() {
    const name = getSnapshot().companion;
    const mode = document.querySelector('#voiceOrb')?.dataset.state || 'idle';
    const states = { idle: 'is ready', connecting: 'is connecting', listening: 'is listening', 'user-speaking': 'is listening', muted: 'is muted', thinking: 'is thinking', speaking: 'is speaking', 'speech-pause': 'is speaking' };
    voiceTitle.textContent = name + ' ' + (states[mode] || 'is ready');
  }
  return { render, renderTranscript, renderVoiceState };
}
