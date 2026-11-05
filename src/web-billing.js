// Browser-only Premium information. Purchases remain inside the existing
// Google Play Billing flow in the native Android app. No unverified credits
// or subscriptions are created from this web dialog.
const PLAY_LISTING = 'https://play.google.com/store/apps/details?id=app.mysecondself';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createWebBillingPanel() {
  const dialog = element('dialog', 'mss-web-billing-dialog');
  dialog.setAttribute('aria-label', 'Premium & Voice Minutes');
  const shell = element('div', 'mss-web-billing-content');
  const head = element('div', 'mss-web-billing-heading');
  const title = element('h2', '', 'Premium & Voice Minutes');
  const close = element('button', 'mss-web-billing-close', 'Close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Premium & Voice Minutes');
  close.addEventListener('click', () => dialog.close());
  head.append(title, close);
  const intro = element('p', '', 'Continue training your future robot with Premium.');
  const plan = element('section', 'mss-web-billing-plan');
  plan.append(
    element('h3', '', 'Premium - $9.99/month'),
    element('p', '', 'Includes 60 voice conversation minutes and $0.50 of AI conversation usage per subscription period.'),
    element('p', '', 'Add voice-minute packs when you need more time. Each verified pack also adds $0.50 of AI conversation credit for the current subscription period.')
  );
  const note = element('p', 'mss-web-billing-note',
    'Purchases are currently completed securely through Google Play in the MySecondSelf Android app. You can view your balance here on the web, but no payment is taken on this page.');
  const launch = element('a', 'mss-web-billing-open-play', 'Open MySecondSelf on Google Play');
  launch.href = PLAY_LISTING;
  launch.target = '_blank';
  launch.rel = 'noopener noreferrer';
  shell.append(head, intro, plan, note, launch);
  dialog.append(shell);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return {
    open() {
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    }
  };
}
