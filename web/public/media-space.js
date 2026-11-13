(() => {
  const player = ".player, .pbar, #library-player, .vplayer, .noisepop";
  const customPlayer = ".pbar, #library-player, .noisepop";
  const playButton = '.pbar-btn.big, [data-player-action="play"], .noiseplay';
  const transport = playButton + ", .player-btn, .playbtn, .vplay";
  const protectedControl = 'input:not([type="range"]), textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])';
  let lastPlayer;
  let handledSpace = false;

  function visible(element) {
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible";
  }

  function playable(element) {
    return !element.srcObject && !element.matches(".reclive, .vrec-live") &&
      !!(element.currentSrc || element.getAttribute("src") || element.querySelector("source[src]"));
  }

  function mediaPlayer(element) {
    return element.closest(player) || element;
  }

  function action(element) {
    const button = element.querySelector(playButton);
    if (button && !button.disabled) return () => button.click();
    const media = element.matches("audio, video") ? element : element.querySelector("audio, video");
    if (!media || !playable(media)) return;
    return () => {
      if (media.paused || media.ended) void media.play().catch(() => {});
      else media.pause();
    };
  }

  function findAction(target) {
    const fullscreen = document.fullscreenElement;
    const scope = fullscreen || document;
    const focused = target?.closest("audio, video, " + player);
    if (focused && scope.contains(focused) && visible(mediaPlayer(focused))) {
      const toggle = action(mediaPlayer(focused));
      if (toggle) return toggle;
    }
    const media = [...scope.querySelectorAll("audio, video")].filter((item) =>
      playable(item) && visible(mediaPlayer(item)));
    if (fullscreen?.matches("audio, video") && playable(fullscreen)) return action(fullscreen);
    if (lastPlayer && scope.contains(lastPlayer) && visible(lastPlayer)) {
      const toggle = action(lastPlayer);
      if (toggle) return toggle;
    }
    const playing = media.find((item) => !item.paused && !item.ended);
    if (playing) return action(mediaPlayer(playing));

    const candidates = new Set([
      ...media.map(mediaPlayer),
      ...scope.querySelectorAll(customPlayer),
    ]);
    const available = [...scope.querySelectorAll("audio, video, " + player)]
      .filter((item) => candidates.has(item) && visible(item));
    if (available.length === 1) return action(available[0]);
    for (const item of available) {
      const bounds = item.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) continue;
      const toggle = action(item);
      if (toggle) return toggle;
    }
  }

  window.__ccMediaForSpace = findAction;
  function rememberPlayer(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const focused = target.closest("audio, video, " + player);
    if (focused) lastPlayer = mediaPlayer(focused);
  }
  document.addEventListener("pointerdown", rememberPlayer, true);
  document.addEventListener("focusin", rememberPlayer, true);
  document.addEventListener("play", (event) => {
    if (event.target instanceof HTMLMediaElement && playable(event.target)) {
      lastPlayer = mediaPlayer(event.target);
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if ((event.code !== "Space" && event.key !== " ") || event.defaultPrevented || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(protectedControl)) return;
    const control = target?.closest("button, a[href], summary, [role=button], [role=checkbox], [role=tab]");
    if (control && !control.matches(transport) &&
        (!control.closest(player) || control.matches(":focus-visible"))) return;
    if (document.querySelector('dialog[open], [role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])')) return;
    let toggle = findAction(target);
    if (!toggle) {
      const frame = document.querySelector("iframe.pane.on");
      if (frame && visible(frame)) {
        try {
          const page = frame.contentWindow;
          toggle = page?.__ccMediaForSpace?.(page.document.activeElement);
        } catch { /* Cross-origin pages use their own shortcuts. */ }
      }
    }
    if (!toggle) return;
    handledSpace = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) toggle();
  }, true);
  window.addEventListener("keyup", (event) => {
    if (!handledSpace || (event.code !== "Space" && event.key !== " ")) return;
    handledSpace = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("blur", () => { handledSpace = false; });
})();
