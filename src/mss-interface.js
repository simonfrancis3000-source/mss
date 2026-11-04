import { voiceBalanceModel } from './voice-balance.js';
import { scenarioProgressSummary } from './scenario-journey.js';

// The presentation layer reads the existing account state. It never writes training data.
export const COMPANION_IMAGE = '/robots/mss-companion.webp';
export const COMPANION_HEAD_IMAGE = '/robots/mss-companion-head.webp';
// Official Booster Robotics product photograph. Does not replace the user's companion illustration.
const BOOSTER_T2_IMAGE = 'https://mysecondself.app/wp-content/uploads/2026/11/powerful-compute.B-k4gGU-copy.jpg';
const ROBOT_REWARD_CAP_CENTS = 100000;
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

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
  coins: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v5c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 10v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5M4 15v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
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

export function createMssInterface({ getSnapshot, navigate, editSettings, openScenario, openWorkspace, shareProgress, refreshBalance, startStep, finishVisit, resumeVisit, openHelp, openGuide, openConnectedHome }) {
  const main = document.querySelector('main');
  let sharingProgress = false;
  let shareStatus = '';
  const screens = {};
  for (const [key, title] of [['home', 'Home'], ['passport', 'Passport'], ['profile', 'Profile'], ['rewards', 'Robot Rewards']]) {
    const section = el('section', 'mss-screen mss-' + key);
    section.id = 'mss-' + key; section.setAttribute('aria-label', title); screens[key] = section; main.prepend(section);
  }
  const transcript = el('section', 'mss-voice-transcript mss-card');
  transcript.setAttribute('aria-label', 'Recent conversation');
  const voiceControls = document.querySelector('.voice-controls');
  if (voiceControls) {
    document.querySelector('#voiceExperienceStatus')?.after(voiceControls);
    voiceControls.after(transcript);
  }
  const liveVoiceProgress = document.querySelector('.voice-experience-content > [data-scenario-progress]');
  const voiceOrb = document.querySelector('#voiceOrb');
  if (liveVoiceProgress && voiceOrb) voiceOrb.before(liveVoiceProgress);
  const voiceCore = document.querySelector('#voiceOrbCore');
  if (voiceCore) {
    const portrait = el('span', 'mss-robot-portrait');
    const image = el('img', 'mss-robot-portrait-image');
    image.src = COMPANION_HEAD_IMAGE; image.alt = ''; image.width = 600; image.height = 600;
    const mouth = el('span', 'mss-robot-mouth'); mouth.setAttribute('aria-hidden', 'true');
    mouth.innerHTML = `<svg viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet" focusable="false">
      <defs>
        <radialGradient id="mssTalkFaceShade"><stop offset="0" stop-color="#242725"/><stop offset="1" stop-color="#272a28"/></radialGradient>
        <filter id="mssTalkMouthFeather" x="-25%" y="-50%" width="150%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
        <filter id="mssTalkMouthGlow" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="2.3"/></filter>
      </defs>
      <ellipse cx="348" cy="345" rx="55" ry="24" fill="url(#mssTalkFaceShade)" filter="url(#mssTalkMouthFeather)"/>
      <g class="mss-robot-mouth-shape">
        <path d="M313 338 Q348 348 383 338 Q383 361 348 361 Q313 361 313 338Z" fill="#03151e" stroke="#27c9ff" stroke-width="6" filter="url(#mssTalkMouthGlow)"/>
        <path d="M313 338 Q348 348 383 338 Q383 361 348 361 Q313 361 313 338Z" fill="#041d29" stroke="#93eeff" stroke-width="2.8"/>
        <path d="M323 351 Q348 359 373 351" fill="none" stroke="#2ba6d9" stroke-width="2" opacity=".65"/>
      </g>
    </svg>`;
    portrait.append(image, mouth);
    voiceCore.replaceChildren(portrait);
  }
  const voiceTitle = el('h2', 'mss-voice-title'); voiceTitle.id = 'mssVoiceState';
  document.querySelector('#voiceExperienceStatus')?.before(voiceTitle);

  const visitToolbars = [];
  for (const target of [document.querySelector('.conversation-panel > [data-scenario-progress]'), voiceControls]) {
    if (!target) continue;
    const toolbar = el('div', 'mss-visit-toolbar');
    target.after(toolbar); visitToolbars.push(toolbar);
  }
  const visitDialog = el('dialog', 'mss-visit-dialog');
  visitDialog.setAttribute('aria-labelledby', 'mssVisitTitle'); document.body.append(visitDialog);
  let recapSaving = false, recapError = '', recapScope = null;
  const snapshotScope = snapshot => snapshot.userId ? snapshot.userId + ':' + snapshot.revision : null;
  async function openVisitRecap() {
    const snapshot = getSnapshot();
    if (!snapshot.model.ready || snapshot.busy || recapSaving) return;
    recapScope = snapshotScope(snapshot); recapSaving = true; recapError = '';
    renderVisitControls(snapshot);
    if (!visitDialog.open) visitDialog.showModal();
    try { await finishVisit?.(); }
    catch (error) { if (recapScope === snapshotScope(getSnapshot())) recapError = error.message || 'Your visit could not be saved. Please try again.'; }
    finally { recapSaving = false; renderVisitControls(); }
  }
  function renderVisitControls(snapshot = getSnapshot()) {
    for (const toolbar of visitToolbars) {
      toolbar.hidden = !snapshot.model.ready || !finishVisit;
      toolbar.replaceChildren();
      if (toolbar.hidden) continue;
      const count = snapshot.savedLearning?.length || 0;
      const label = count ? (snapshot.visit?.ended_at ? 'Last visit: ' : '') + count + (count === 1 ? ' preference saved' : ' preferences saved')
        : snapshot.learningSyncPending ? 'Learning is syncing…' : snapshot.visitAnswers >= 3 && !snapshot.visit?.ended_at ? 'A good place to pause' : 'One small step at a time';
      const finish = action('Finish for now', 'mss-text-button', openVisitRecap); finish.disabled = Boolean(snapshot.busy || recapSaving);
      toolbar.append(el('span', '', label), finish);
    }
    if (!recapScope) return;
    if (recapScope !== snapshotScope(snapshot)) { visitDialog.close(); recapScope = null; return; }
    visitDialog.replaceChildren();
    const title = el('h2', '', 'Your visit recap'); title.id = 'mssVisitTitle';
    const status = el('p', 'mss-visit-save-status', recapSaving ? 'Saving your conversation and place…' : recapError || 'Your conversation and place are saved.');
    status.setAttribute('role', 'status');
    visitDialog.append(title, status);
    const saved = snapshot.savedLearning || [];
    if (saved.length) {
      visitDialog.append(el('h3', '', 'Saved learning from this visit'));
      const list = el('ul', 'mss-visit-learnings');
      for (const memory of saved) {
        const item = el('li', '', memory.statement);
        const conditions = (memory.conditions || []).filter(value => typeof value === 'string');
        if (conditions.length) item.append(el('small', '', 'Conditions: ' + conditions.join('; ')));
        const permission = { ask_first: 'Ask me first', allowed: 'Explicitly allowed for this action', prohibited: 'Do not do this' }[memory.permission_policy];
        if (permission) item.append(el('small', '', 'Permission: ' + permission));
        list.append(item);
      }
      visitDialog.append(list);
    } else visitDialog.append(el('p', '', 'No new saved preferences to show for this visit yet. Your conversation can still be continued.'));
    if (snapshot.learningSyncPending) visitDialog.append(el('p', 'mss-visit-note', 'Some learning is still syncing. This recap updates when it is saved.'));
    visitDialog.append(el('p', 'mss-visit-note', 'Finishing a visit does not complete a module. Review your learning when you are ready.'));
    if (snapshot.pendingQuestion) {
      visitDialog.append(el('h3', '', 'Next time'), el('p', 'mss-visit-checkpoint', snapshot.pendingQuestion));
    }
    const actions = el('div', 'mss-visit-actions');
    const finish = action(recapError ? 'Retry saving' : 'Finish for now', 'mss-primary', () => {
      if (recapError) { void openVisitRecap(); return; }
      visitDialog.close(); navigate('home');
    });
    const keepGoing = action('Continue', 'mss-secondary', () => { visitDialog.close(); resumeVisit?.(); renderVisitControls(); });
    finish.disabled = keepGoing.disabled = recapSaving; actions.append(finish, keepGoing);
    if (saved.length && snapshot.visit?.scenario_id) {
      const review = action('Review or edit learning', 'mss-text-button', () => { visitDialog.close(); openScenario(snapshot.visit.scenario_id); });
      review.disabled = recapSaving; actions.append(review);
    }
    visitDialog.append(actions);
  }
  visitDialog.addEventListener('close', () => { recapScope = null; });

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
      const next = action('View training', 'mss-primary', () => navigate('passport')); next.append(symbol('arrow')); copy.append(next);
    }
    card.append(image, copy); return card;
  }
  function progress(snapshot, passport = false) {
    const model = snapshot.model;
    const card = passport
      ? el('section', 'mss-card mss-progress')
      : action('', 'mss-card mss-progress', () => navigate('passport'));
    if (!passport) card.setAttribute('aria-label', 'Open Passport training progress and modules');
    const row = el('div', 'mss-progress-heading'); row.append(el('h2', '', passport ? snapshot.companion + ' profile completion' : 'Training progress'), el('strong', '', model.ready ? model.percent + '%' : '—'));
    const track = el('div', 'mss-progress-track'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', 'Training scenarios completed'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
    if (model.ready) track.setAttribute('aria-valuenow', String(model.percent)); else track.setAttribute('aria-valuetext', 'Progress unavailable');
    const fill = el('span'); fill.style.width = model.percent + '%'; track.append(fill);
    const caption = el('p', '', model.ready ? model.completed + ' of ' + model.total + ' scenarios confirmed complete.' : 'Your saved progress will appear when your account is connected.'); caption.prepend(symbol('bars'));
    card.append(row, track, caption);
    return card;
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
        if (card.isConnected) card.replaceWith(progressChart(getSnapshot()));
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

  function rewardState(snapshot) {
    const raw = snapshot.rewards;
    const verified = raw?.status === 'ready' && Number.isSafeInteger(raw.earnedCents) && raw.earnedCents >= 0;
    const earned = verified ? Math.min(ROBOT_REWARD_CAP_CENTS, raw.earnedCents) : null;
    return { earned, percent: earned === null ? 0 : earned / ROBOT_REWARD_CAP_CENTS * 100, verified };
  }
  function rewardTrack(className, percent, label) {
    const track = el('span', className);
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(percent)));
    const fill = el('span');
    fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    track.append(fill);
    return track;
  }
  function rewardTeaser(snapshot) {
    const summary = rewardState(snapshot);
    const card = action('', 'mss-rewards-teaser', () => navigate('rewards'));
    card.setAttribute('aria-label', 'Open Robot Rewards');
    const row = el('span', 'mss-rewards-teaser-row');
    const label = el('span', 'mss-rewards-teaser-title');
    label.append(el('strong', '', 'Robot Rewards'));
    row.append(label, el('strong', 'mss-rewards-teaser-value', summary.verified ? money(summary.earned) + ' / $1,000' : 'Credit pending'));
    card.append(row, rewardTrack('mss-rewards-teaser-track', summary.percent, 'Robot credit earned'));
    return card;
  }
  function rewardsPage(snapshot) {
    const summary = rewardState(snapshot);
    const percent = snapshot.model.ready ? snapshot.model.percent : 0;
    const container = el('div', 'mss-rewards-page');
    const toolbar = el('header', 'mss-rewards-toolbar');
    const back = action('', 'mss-rewards-back', () => navigate('home'));
    back.setAttribute('aria-label', 'Back to home');
    back.append(symbol('chevron'));
    toolbar.append(back, el('h1', '', 'Robot Rewards'), el('span', 'mss-rewards-toolbar-spacer'));
    container.append(toolbar);

    const hero = el('section', 'mss-rewards-partner');
    const partner = el('div', 'mss-rewards-partner-copy');
    partner.append(el('span', 'mss-rewards-partner-eyebrow', 'Manufacturer partner'));
    partner.append(el('strong', 'mss-rewards-partner-name', 'Booster Robotics'));
    partner.append(el('span', 'mss-rewards-featured', 'Featured partner robot'));
    partner.append(el('h2', '', 'Booster T2'));
    const photo = el('img', 'mss-rewards-booster-image');
    photo.src = BOOSTER_T2_IMAGE;
    photo.alt = 'Booster T2 full-body humanoid robot';
    photo.loading = 'lazy';
    photo.decoding = 'async';
    photo.width = 512;
    photo.height = 512;
    hero.append(partner, photo);
    container.append(hero);

    const credit = el('section', 'mss-rewards-credit');
    credit.append(el('h2', '', 'Robot credit earned'));
    if (summary.verified) {
      credit.append(el('strong', 'mss-rewards-credit-total', money(summary.earned)));
      credit.append(el('p', '', 'of $1,000 maximum'));
    } else {
      credit.append(el('p', 'mss-rewards-credit-limit', 'Maximum possible credit: $1,000'));
    }
    credit.append(rewardTrack('mss-rewards-credit-track', summary.percent, 'Credit progress towards $1,000'));
    const numbers = el('div', 'mss-rewards-credit-breakdown');
    numbers.append(el('span', '', summary.verified ? Math.round(summary.percent) + '% earned' : 'Balance pending'),
      el('span', '', summary.verified ? money(ROBOT_REWARD_CAP_CENTS - summary.earned) + ' credit available' : '$1,000 maximum'));
    credit.append(numbers);
    container.append(credit);

    const training = el('section', 'mss-rewards-training');
    const trainingTitle = el('div', 'mss-rewards-training-heading');
    trainingTitle.append(symbol('passport'), el('h2', '', 'Robot Ready training'),
      el('strong', '', snapshot.model.ready ? percent + '%' : '—'));
    training.append(trainingTitle, rewardTrack('mss-rewards-training-track', percent, 'Training scenarios completed'));
    training.append(el('p', '', 'Reach 80% of core training and pass the readiness assessment to unlock redemption.'));
    container.append(training);

    const offer = el('div', 'mss-rewards-offer');
    offer.append(symbol('coins'), el('p', '', 'Earn $2 credit for every $1 in eligible spending. Redeem up to 5% off a participating robot, limited by your earned credit.'));
    container.append(offer);
    const footer = el('div', 'mss-rewards-partner-footer');
    footer.append(el('strong', '', 'Partner: Booster Robotics'));
    container.append(footer);
    const details = el('details', 'mss-rewards-terms');
    const opener = el('summary', '', 'How Robot Rewards work');
    const lead = el('p', 'mss-rewards-terms-lead',
      'Your discount is the lowest of your unused earned credit, 5% of the eligible robot hardware price and any lower published manufacturer offer limit.');
    const example = el('p', 'mss-rewards-terms-example',
      'Example: $900 earned credit on a $5,000 robot = $250 off (5%). The remaining $650 is not lost and stays available for a future qualifying purchase while valid.');
    details.append(opener, lead, example);
    const sections = [
      ['Earning limits', 'Each $1 actually paid for eligible MySecondSelf subscriptions or voice top-ups earns $2 promotional credit, up to $100 per UTC calendar month and $1,000 earned per account over its lifetime. Free trials, licensed tester allowances, complimentary minutes and refunded, reversed or charged-back payments do not qualify. Only payment records verified by the payment provider count.'],
      ['Currency', 'Robot Rewards balances are currently calculated for verified USD payments. Payments in other currencies remain pending until a published conversion method is supported. Any local-currency redemption, exchange rate and rounding will be disclosed before checkout.'],
      ['Who can redeem', 'The purchaser must be an adult using the same verified MySecondSelf account that earned the credit. Redemption requires the published Robot Ready criteria: currently at least 80% of core training, a passed readiness assessment and six qualifying paid subscription months. Completing training does not guarantee robot availability.'],
      ['How the 5% limit is calculated', 'The 5% cap applies to the eligible robot hardware selling price at checkout, after any other price reductions the manufacturer permits. Shipping, taxes, accessories, setup, finance charges, rentals and subscriptions do not count toward the eligible hardware price. The partner must show the complete final purchase price and actual discount before payment.'],
      ['Eligible robots and restrictions', 'Only participating manufacturer models, locations and authorised purchase channels qualify. One Robot Rewards discount may be applied per robot order, and only one redemption is permitted per verified buyer in any rolling 12-month period. Rewards from multiple accounts cannot be combined. Rewards cannot be transferred, sold, gifted, withdrawn or converted into cash, and cannot be combined with another promotion unless the manufacturer expressly permits it.'],
      ['Unused credit', 'Only the amount actually deducted from the robot purchase uses the rewards balance. Any unused earned credit remains in your account for a later qualifying purchase while valid, subject to the same program caps and eligibility requirements. No cash change or reimbursement is provided for unused credit.'],
      ['Verification and refunds', 'Earned credit can be held for up to 45 days before becoming redeemable while payments clear. Refunds, cancellations, chargebacks, purchase reversals, payment errors or confirmed misuse can reduce or reverse credit, including after it was displayed. We may request reasonable identity and transaction checks and may suspend suspicious redemption requests while reviewing them, subject to applicable law.'],
      ['Cancelled or returned robot purchases', 'If the manufacturer confirms a qualifying robot order cancellation or return, the applied promotional credit is restored to the rewards account, not refunded as cash. The manufacturer handles the hardware purchase, delivery, returns and warranties. Nothing in these rules limits mandatory consumer rights.'],
      ['Availability, expiry and changes', 'Manufacturer prices, participating models, regions and stock may change. An earned credit balance does not reserve a robot or fix its future price. Any expiry date will be disclosed in your account before credit is earned and displayed while it remains valid. Material program changes will be announced in advance and will apply prospectively, except where corrections are required for refunds, errors, fraud or law.'],
      ['Before checkout', 'Your exact eligible discount, participating model, any partner-specific limit, applicable taxes, delivery charges and final total will be disclosed before you confirm a purchase. Partner-specific offers cannot remove rights guaranteed by applicable consumer law.']
    ];
    for (const [title, description] of sections) {
      const section = el('section', 'mss-rewards-terms-section');
      section.append(el('h3', '', title), el('p', '', description));
      details.append(section);
    }
    container.append(details);
    return container;
  }

  function render() {
    const snapshot = getSnapshot(), { model } = snapshot;
    avatar(headerAvatar, snapshot); avatar(voiceAvatar, snapshot);
    headerAvatar?.setAttribute('aria-label', 'Open profile');
    const home = screens.home; home.replaceChildren(heading('Hi ' + (snapshot.owner?.split(/\s+/)[0] || 'there'), 'Keep training your future robot with your knowledge, habits, boundaries and preferences.'), banner(snapshot), progress(snapshot), rewardTeaser(snapshot));
    if (snapshot.step && model.ready) {
      const next = el('section', 'mss-card mss-next-step');
      next.append(el('p', 'mss-next-eyebrow', 'Your next small step · ' + model.active.title), el('h2', '', snapshot.step.title), el('p', 'mss-next-description', snapshot.step.description));
      next.append(el('p', 'mss-area-progress', (snapshot.explored || 0) + '/' + model.active.total + ' areas explored · ' + model.active.reviewed + ' reviewed'));
      next.append(el('p', 'mss-visit-note', snapshot.step.kind === 'review' ? 'Review at your own pace.' : 'Try a few minutes. Pause whenever you like.'));
      const actions = el('div', 'mss-next-actions');
      const begin = action(snapshot.step.kind === 'resume' ? 'Continue talking' : snapshot.step.kind === 'review' ? 'Review learning' : 'Start in Chat', 'mss-primary', () => startStep?.(snapshot.step));
      begin.disabled = snapshot.busy || !startStep;
      actions.append(begin, action('Choose a task', 'mss-text-button', () => openScenario(model.active.id))); next.append(actions); home.append(next);
    }
    const how = action('How it works', 'mss-how-link', () => openGuide?.()); home.querySelector('.mss-page-heading')?.append(how);
    const focus = el('div', 'mss-section-heading'); focus.append(el('h2', '', 'Today’s focus'));
    const seeAll = action('See all', 'mss-text-button', () => navigate('passport')); seeAll.append(symbol('arrow')); focus.append(seeAll); home.append(focus);
    const topics = el('div', 'mss-focus-grid');
    const currentIndex = Math.max(0, model.modules.findIndex(m => m.id === model.active?.id));
    model.modules.slice(currentIndex, currentIndex + 3).forEach(item => topics.append(moduleCard(item, true))); home.append(topics);
    if (!snapshot.step) home.append(linkCard('Current conversation', snapshot.pendingQuestion || 'Continue where you left off with ' + snapshot.companion + '.', 'chat', () => navigate('chat')));

    screens.rewards.replaceChildren(rewardsPage(snapshot));

    const passport = screens.passport; passport.replaceChildren(heading('Passport', 'Build your robot through conversation.'), progressChart(snapshot), el('h2', 'mss-section-title', 'Training modules'));
    const grid = el('div', 'mss-module-grid'); model.modules.forEach(item => grid.append(moduleCard(item))); passport.append(grid);
    passport.append(linkCard('What’s next', model.active ? 'Continue with ' + model.active.title + '.' : 'Review and refine your saved preferences.', 'chat', () => navigate('chat')));
    passport.append(linkCard('Your saved preferences', 'Review the details, conditions and permissions you have shared.', 'brain', () => openWorkspace('personaPassport')));

    const profile = screens.profile;
    const profileHeading = heading('Profile');
    profileHeading.classList.add('mss-profile-heading');
    const profileRewards = action('Robot Rewards', 'mss-profile-rewards-button', () => navigate('rewards'));
    profileRewards.setAttribute('aria-label', 'Open Robot Rewards');
    profileHeading.append(profileRewards);
    profile.replaceChildren(profileHeading);
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
    settings.append(linkCard('Help & Getting Started', 'FAQs, replay the introduction and contact support', 'support', () => openHelp?.()),
      linkCard('Connected Home', 'Identify supported devices for robot training (read-only)', 'home', () => openConnectedHome?.()),
      linkCard('Reminders', 'Your saved to-do list and things to return to', 'bell', () => openWorkspace('todoReminders')),
      linkCard('Privacy', 'Your data, training and sharing preferences', 'lock', () => editSettings('shareAnonymizedLearning')),
      linkCard('Voice settings', 'Voice and conversation language', 'mic', () => editSettings('robotVoice')));
    profile.append(settings);

    renderTranscript(snapshot); renderVoiceState(); renderVisitControls(snapshot);
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
  return { render, renderTranscript, renderVoiceState, renderVisitControls, createProgressChart: () => progressChart(getSnapshot()), getActiveScenarioId: () => { const { model } = getSnapshot(); return model.ready ? model.active?.id : null; } };
}
