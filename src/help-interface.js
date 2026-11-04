import { AMIA_INTRO_AUDIO, FAQ_CATEGORIES, onboardingPages, searchFaq } from './getting-started-content.js';
const el = (tag, className = '', value) => { const node = document.createElement(tag); node.className = className; if (value !== undefined) node.textContent = value; return node; };
const button = (text, className, run) => { const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', run); return node; };

export function createHelpInterface({ getContext, navigate, dismiss, pauseTalk, editPrivacy, openSupport, snapshot }) {
  const page = el('section', 'mss-screen mss-help'); page.id = 'mss-help'; page.setAttribute('aria-label', 'Help & Getting Started'); document.querySelector('main')?.append(page);
  const guide = el('dialog', 'mss-onboarding'); guide.setAttribute('aria-labelledby', 'mssGuideTitle'); document.body.append(guide);
  const guideContent = el('div', 'mss-guide-content'), player = el('div', 'mss-guide-player'); player.hidden = true; guide.append(guideContent, player);
  const audio = el('audio'); audio.controls = true; audio.preload = 'none'; audio.src = AMIA_INTRO_AUDIO;
  const audioStatus = el('p', 'mss-help-notice'); audioStatus.setAttribute('role', 'status'); audioStatus.hidden = true;
  player.append(audio, audioStatus);
  audio.addEventListener('playing', () => { audioStatus.hidden = true; });
  function playIntroduction({ restart = false } = {}) {
    player.hidden = false;
    if (restart) { try { audio.currentTime = 0; } catch {} }
    audioStatus.textContent = 'Loading the introduction…'; audioStatus.hidden = false;
    void audio.play().catch(() => {
      audioStatus.textContent = 'The introduction could not start. Press Play in the audio controls, or try Listen again.';
      audioStatus.hidden = false;
    });
  }
  let index = 0, automatic = false, saving = false, guideOwner = null, guideGeneration = 0, origin = 'profile', voiceWasPaused = false;
  function syncScope() {
    if (guide.open && guideOwner !== getContext().userId) { guideGeneration++; saving = false; audio.pause(); guide.close(); }
  }
  async function finishGuide(outcome, destination) {
    if (saving) return;
    const generation = guideGeneration, owner = guideOwner;
    saving = true; audio.pause(); renderGuide();
    try { await dismiss(outcome); }
    finally {
      if (generation === guideGeneration) {
        saving = false; audio.pause(); guide.close();
        if (owner === getContext().userId && destination) navigate(destination);
      }
    }
  }
  function renderGuide() {
    const context = getContext(), companion = String(context.companion || '').trim() || 'Vikki', pages = onboardingPages(companion), item = pages[index];
    guideContent.replaceChildren();
    const top = el('div', 'mss-guide-top');
    const skip = button(automatic ? 'Skip for now' : 'Close', 'mss-text-button', () => void finishGuide('skipped'));
    skip.disabled = saving; top.append(el('span', '', 'Step ' + (index + 1) + ' of ' + pages.length), skip); guideContent.append(top);
    const image = el('img', 'mss-guide-robot'); image.src = '/robots/mss-companion-head.webp'; image.width = 130; image.height = 130; image.alt = '';
    const title = el('h1', '', item.title); title.id = 'mssGuideTitle';
    guideContent.append(image, title, el('p', 'mss-guide-lead', item.lead));
    for (const paragraph of item.paragraphs) guideContent.append(el('p', '', paragraph));
    if (index === 0) {
      const listen = button('Listen to ' + companion, 'mss-guide-audio-toggle', () => playIntroduction());
      listen.disabled = saving; guideContent.append(listen);
    }
    audio.setAttribute('aria-label', companion + ' introduction audio');
    const actions = el('div', 'mss-guide-actions');
    if (index) { const back = button('Back', 'mss-secondary', () => { index--; renderGuide(); }); back.disabled = saving; actions.append(back); }
    const next = button(saving ? 'Saving…' : index === pages.length - 1 ? (automatic ? 'Start My Journey' : 'Return to my journey') : 'Next', 'mss-primary', () => {
      if (index < pages.length - 1) { index++; renderGuide(); guide.scrollTop = 0; }
      else void finishGuide('completed', automatic ? 'talk' : null);
    });
    next.disabled = saving; actions.append(next);
    if (index === pages.length - 1 && automatic) { const chat = button('Use Chat instead', 'mss-text-button', () => void finishGuide('completed', 'chat')); chat.disabled = saving; actions.append(chat); }
    guideContent.append(actions);
    requestAnimationFrame(() => { if (guide.open) title.focus({ preventScroll: true }); }); title.tabIndex = -1;
  }
  guide.addEventListener('cancel', event => { event.preventDefault(); void finishGuide('skipped'); });
  guide.addEventListener('close', () => audio.pause());
  function openGuide({ auto = false } = {}) {
    if (guide.open) return false;
    const context = getContext(); if (!context.userId || (auto && !context.profileReady)) return false;
    guideGeneration++; guideOwner = context.userId; automatic = auto; index = 0;
    audio.pause(); player.hidden = true; audioStatus.hidden = true;
    try { audio.currentTime = 0; } catch {}
    if (context.talkActive) pauseTalk();
    renderGuide(); guide.showModal(); guide.scrollTop = 0;
    return true;
  }
  function replayIntroduction() {
    if (openGuide()) playIntroduction({ restart: true });
  }
  function openHelp(questionId) {
    const context = getContext();
    origin = context.talkVisible ? 'talk' : ['home', 'profile', 'passport'].includes(context.view) ? context.view : 'chat';
    voiceWasPaused = Boolean(context.talkActive);
    navigate('help'); renderHelp(questionId); window.scrollTo({ top: 0 });
  }
  function renderHelp(questionId) {
    page.replaceChildren();
    const top = el('header', 'mss-help-heading'); top.append(button('← Back', 'mss-text-button', () => navigate(origin)), el('h1', '', 'Help & Getting Started'));
    page.append(top, el('p', 'mss-help-intro', 'Understand what you are building, how training works, and what is available today.'));
    if (voiceWasPaused) page.append(el('p', 'mss-help-notice', 'Talk is paused while you view Help. Press Start after returning to continue.'));
    const replay = button('Replay the introduction', 'mss-primary', replayIntroduction); page.append(replay);
    const sync = el('p', 'mss-help-sync'); sync.setAttribute('role', 'status'); sync.hidden = !snapshot().syncPending; sync.textContent = 'Your introduction choice is remembered on this device. Account sync will retry when you reconnect.'; page.append(sync);
    const label = el('label', 'mss-help-search-label', 'Search Help & FAQ'); label.htmlFor = 'mssHelpSearch';
    const search = el('input', 'mss-help-search'); search.id = 'mssHelpSearch'; search.type = 'search'; search.placeholder = 'Try “progress”, “garden” or “minutes”';
    const results = el('div', 'mss-help-results'); page.append(label, search, results);
    const renderResults = () => {
      results.replaceChildren();
      for (const category of searchFaq(search.value)) {
        const group = el('section', 'mss-faq-category'); group.append(el('h2', '', category.title));
        for (const item of category.questions) {
          const detail = el('details', 'mss-faq'); detail.id = 'faq-' + item.id;
          const summary = el('summary', '', item.question); detail.append(summary, el('p', '', item.answer));
          if (item.action) {
            const actions = { guide: ['Replay introduction', replayIntroduction], passport: ['Open Passport', () => navigate('passport')], rewards: ['Open Robot Rewards', () => navigate('rewards')], privacy: ['Open Privacy settings', editPrivacy], support: ['Contact support', openSupport] };
            const [title, run] = actions[item.action]; detail.append(button(title, 'mss-text-button', run));
          }
          if (item.id === questionId) detail.open = true;
          group.append(detail);
        }
        results.append(group);
      }
      if (!results.children.length) results.append(el('p', 'mss-help-empty', 'No matching answers. Try a different word, or contact support below.'));
    };
    search.addEventListener('input', renderResults); renderResults();
    page.append(button('Contact support', 'mss-secondary', openSupport));
    if (questionId && FAQ_CATEGORIES.some(category => category.questions.some(item => item.id === questionId))) requestAnimationFrame(() => page.querySelector('#faq-' + questionId)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
  function contextButton(questionId = 'progress') {
    const node = button('?', 'mss-context-help', () => openHelp(questionId)); node.setAttribute('aria-label', 'Help with training progress and resuming'); return node;
  }
  return { openGuide, openHelp, contextButton, syncScope, renderStatus() { syncScope(); const note = page.querySelector('.mss-help-sync'); if (note) note.hidden = !snapshot().syncPending; } };
}
