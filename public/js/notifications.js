(() => {
  const $ = id => document.getElementById(id);
  const toggle = $('notifications-toggle');
  let registration; let config; let subscription; let enabled = false; let busy = true;
  let state = 'notifications.loading'; let help = 'notifications.description'; let supported = false;
  let initialization = Promise.resolve(); let revision = 0;
  const locale = () => window.getLocale?.() || 'ru';
  function render() {
    toggle.disabled = busy || !supported || !config?.enabled || Notification.permission === 'denied';
    toggle.textContent = window.t(enabled ? 'notifications.disable' : 'notifications.enable');
    toggle.setAttribute('aria-pressed', String(enabled));
    $('notifications-status').textContent = window.t(state);
    $('notifications-help').textContent = window.t(help);
  }
  function publicKey(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), character => character.charCodeAt(0));
  }
  function appleNeedsInstall() {
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return apple && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches;
  }
  async function saveSubscription(value) {
    await window.Api.pushSubscribe({ subscription: value.toJSON(), locale: locale() });
  }
  async function setup(currentRevision) {
    supported = !appleNeedsInstall() && window.isSecureContext && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
    if (!supported) {
      enabled = false;
      state = 'notifications.unavailable'; help = appleNeedsInstall() ? 'notifications.appleInstall' : 'notifications.unsupported';
      busy = false; render(); return;
    }
    try {
      config = await window.Api.pushConfig();
      if (!config.enabled) { enabled = false; state = 'notifications.serverDisabled'; return; }
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
      registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
      if (currentRevision !== revision) return;
      if (Notification.permission === 'denied') { state = 'notifications.denied'; enabled = false; }
      else if (subscription && localStorage.getItem('notifications-enabled') !== 'false') {
        await saveSubscription(subscription); enabled = true; state = 'notifications.on';
      } else { enabled = false; state = 'notifications.off'; }
    } catch { enabled = false; state = 'notifications.error'; }
    finally { if (currentRevision === revision) { busy = false; render(); } }
  }
  function initialize() {
    const currentRevision = ++revision;
    busy = true; state = 'notifications.loading';
    initialization = initialization.catch(() => {}).then(() => setup(currentRevision));
    return initialization;
  }
  toggle.addEventListener('click', async () => {
    if (busy || !supported || !config?.enabled) return;
    busy = true; render();
    try {
      if (enabled) {
        await window.Api.pushUnsubscribe(subscription.endpoint);
        localStorage.setItem('notifications-enabled', 'false'); enabled = false;
        await subscription.unsubscribe(); subscription = null; state = 'notifications.off';
      } else {
        // Permission must be requested directly from this tap, before other awaits.
        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') { state = permission === 'denied' ? 'notifications.denied' : 'notifications.off'; return; }
        subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey(config.publicKey) });
        await saveSubscription(subscription);
        localStorage.setItem('notifications-enabled', 'true'); enabled = true; state = 'notifications.on';
      }
    } catch { state = 'notifications.error'; }
    finally { busy = false; render(); }
  });
  $('notifications-open').addEventListener('click', () => $('speech-settings-open').click());
  $('speech-settings-open').addEventListener('click', () => { if (!busy) initialize(); });
  window.addEventListener('authenticated', initialize);
  window.addEventListener('localechange', () => { render(); if (enabled && !busy) saveSubscription(subscription).catch(() => {}); });
  if (window.accessState) initialize();
})();
