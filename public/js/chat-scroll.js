(() => {
  const feed = document.getElementById('feed');
  const button = document.getElementById('scroll-to-bottom');
  let frame = null;
  function update() {
    frame = null;
    button.hidden = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 80;
  }
  function schedule() {
    if (frame === null) frame = requestAnimationFrame(update);
  }
  button.addEventListener('click', () => {
    // CSS handles smooth scrolling and reduced-motion preferences.
    feed.scrollTo({ top: feed.scrollHeight });
    feed.focus({ preventScroll: true });
  });
  feed.setAttribute('tabindex', '-1');
  feed.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(schedule).observe(feed);
  new MutationObserver(schedule).observe(feed, { childList: true, subtree: true, characterData: true, attributes: true });
  document.getElementById('chat-font-size').addEventListener('change', schedule);
  window.addEventListener('localechange', schedule);
  window.addEventListener('resize', schedule);
  schedule();
})();
