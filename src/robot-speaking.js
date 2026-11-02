// Follow audible playback state. Earlier messages and picker thumbnails stay still.
export function syncRobotSpeaking(root, speaking) {
  root.querySelectorAll('[data-robot-speaking]').forEach(node => node.removeAttribute('data-robot-speaking'));
  if (!speaking) return;
  const core = root.querySelector('#voiceOrbCore');
  if (core?.firstElementChild) core.setAttribute('data-robot-speaking', 'true');
  const avatars = root.querySelectorAll('.assistant-message .robot-message-avatar');
  const latest = avatars[avatars.length - 1];
  if (latest && !latest.hidden && latest.firstElementChild) latest.setAttribute('data-robot-speaking', 'true');
}
