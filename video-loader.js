// Load videos in priority order, chunk first: a video holds the start slot only
// until its first chunk (data-first-chunk seconds) is buffered, then keeps
// streaming later chunks while the next video starts. Videos in hidden panels
// only fetch metadata once everything visible has started.
window.createVideoLoader = function (videos, initialSection) {
  const MAX_STARTING = 1;
  const MAX_OPEN = 3;
  const STALL_TIMEOUT = 30000;
  const DEFAULT_FIRST_CHUNK = 10;
  const records = new Map(videos.map((video, index) => [video, {
    video, index, state: "queued", mode: null, interactive: false, cleanup: null
  }]));
  const hero = videos.find((video) => video.id === "hero-background-video");
  const story = videos.find((video) => video.id === "story-video");
  let preferredSection = initialSection || "classic_v2_010";
  let navigated = Boolean(initialSection);
  let navigationUntil = 0;
  let scheduled = false;

  function setStatus(video, status) {
    video.dataset.loadState = status;
    const button = video.closest(".video-frame")?.querySelector(".video-load-button");
    if (!button) return;
    button.hidden = status === "ready";
    button.textContent = status === "error" ? "Retry video"
      : status === "loading" ? "Loading video…" : "Load video";
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      pump();
    });
  }

  function inState(...states) {
    return [...records.values()].filter((record) => states.includes(record.state));
  }

  function firstChunkBuffered(video) {
    const target = Number(video.dataset.firstChunk) || DEFAULT_FIRST_CHUNK;
    const end = Number.isFinite(video.duration) ? Math.min(target, video.duration - 0.1) : target;
    for (let i = 0; i < video.buffered.length; i += 1) {
      if (video.buffered.start(i) <= 0.1) return video.buffered.end(i) >= end;
    }
    return false;
  }

  function reset(record, state = "queued") {
    record.cleanup?.();
    record.state = state;
    record.mode = null;
    record.video.pause();
    record.video.removeAttribute("src");
    record.video.preload = "none";
    record.video.load();
    setStatus(record.video, state === "deferred" ? "error" : "idle");
  }

  function begin(record, mode) {
    const { video } = record;
    const upgrade = record.state === "primed";
    record.cleanup?.();
    record.state = "starting";
    record.mode = mode;
    if (mode === "auto") setStatus(video, "loading");
    let timer;

    function done(state) {
      record.cleanup();
      record.state = state;
      if (state === "ready") setStatus(video, "ready");
      if (state === "deferred") setStatus(video, "error");
      schedule();
    }

    function resetTimeout() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (record.state === "streaming" || (!video.paused && video.readyState >= 2)) {
          done(video.readyState >= 2 ? "ready" : "primed");
        } else {
          reset(record, "deferred");
          schedule();
        }
      }, STALL_TIMEOUT);
    }

    function check() {
      const idle = video.networkState === HTMLMediaElement.NETWORK_IDLE;
      if (record.mode === "metadata") {
        if (video.readyState >= 1) done("primed");
        return;
      }
      if (video.readyState < 2) return;
      setStatus(video, "ready");
      if (idle) done("ready");
      else if (record.state === "starting" && firstChunkBuffered(video)) {
        record.state = "streaming";
        schedule();
      }
    }

    const onProgress = () => { resetTimeout(); check(); };
    const events = [
      ["progress", onProgress], ["loadedmetadata", onProgress],
      ["loadeddata", check], ["canplay", check], ["canplaythrough", check],
      ["suspend", check], ["error", () => done("deferred")]
    ];
    record.cleanup = () => {
      clearTimeout(timer);
      for (const [event, handler] of events) video.removeEventListener(event, handler);
      record.cleanup = null;
    };
    for (const [event, handler] of events) video.addEventListener(event, handler);
    resetTimeout();
    video.preload = mode;
    if (upgrade && video.getAttribute("src") === video.dataset.src) {
      if (video.networkState === HTMLMediaElement.NETWORK_IDLE) video.load();
      check();
    } else {
      video.src = video.dataset.src;
      video.load();
    }
  }

  function visible(video) {
    if (!video.getClientRects().length) return false;
    if (video !== hero) return true;
    const bounds = hero.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight;
  }

  function priority(record) {
    const { video } = record;
    if (record.interactive) return -4;
    if (video.dataset.case === preferredSection) return navigated ? -3 : -2;
    if (video === story && !navigated) return -3;
    const bounds = video.getBoundingClientRect();
    if (bounds.bottom > 0 && bounds.top < innerHeight) return -1;
    return record.index;
  }

  function pump() {
    if (document.hidden) return;
    const waiting = inState("queued", "primed")
      .filter((record) => record.video.dataset.src)
      .sort((a, b) => priority(a) - priority(b) || a.index - b.index);
    let starting = inState("starting").length;
    let open = starting + inState("streaming").length;
    let visibleWaiting = false;

    for (const record of waiting) {
      if (record.interactive) {
        begin(record, "auto");
        starting += 1;
        open += 1;
        continue;
      }
      if (!visible(record.video)) continue;
      visibleWaiting = true;
      if (starting >= MAX_STARTING || open >= MAX_OPEN) break;
      begin(record, "auto");
      starting += 1;
      open += 1;
    }

    if (visibleWaiting || starting || open >= MAX_OPEN) return;
    const hidden = waiting.find((record) => record.state === "queued" && !visible(record.video));
    if (hidden) begin(hidden, "metadata");
  }

  function prioritize(sectionId, fromScroll = false) {
    if (!sectionId) return;
    preferredSection = sectionId;
    navigated = true;
    if (!fromScroll) navigationUntil = performance.now() + 1500;
    // A jump should not wait behind first chunks from a story the visitor skipped.
    for (const record of inState("starting")) {
      if (record.video.dataset.case !== sectionId && !record.interactive && record.video.paused) {
        reset(record);
      }
    }
    schedule();
  }

  function request(video, play = false) {
    const record = records.get(video);
    if (!record) return;
    record.interactive = true;
    if (record.state === "deferred") record.state = "queued";
    if (record.state === "queued" || record.state === "primed") {
      for (const other of inState("starting")) {
        if (!other.interactive && other.video.paused) reset(other);
      }
    }
    pump();
    if (play && video.getAttribute("src")) video.play().catch(() => {});
  }

  // Point a video at a new data-src, e.g. when the story tab changes.
  function replace(video, interactive = false) {
    const record = records.get(video);
    if (!record) return;
    reset(record);
    record.interactive = false;
    if (interactive) request(video);
    else schedule();
  }

  for (const video of videos) {
    setStatus(video, "idle");
    video.closest(".video-frame")?.querySelector(".video-load-button")
      ?.addEventListener("click", () => request(video, true));
    if (video !== hero) {
      video.addEventListener("play", () => {
        const record = records.get(video);
        if (record.state !== "starting" && record.state !== "streaming" && record.state !== "ready") {
          request(video, true);
        }
      });
    }
    video.addEventListener("error", () => {
      const record = records.get(video);
      if (record.cleanup || !video.getAttribute("src")) return;
      record.state = "deferred";
      setStatus(video, "error");
    });
  }

  // Prepare the approaching story before its videos enter the viewport.
  function updateVisibleSection() {
    if (performance.now() < navigationUntil) return;
    const sections = [...document.querySelectorAll("[data-case-section]")];
    const approaching = sections.find((section) => {
      const bounds = section.getBoundingClientRect();
      return bounds.bottom > innerHeight * 0.25 && bounds.top < innerHeight + 400;
    });
    if (approaching && approaching.id !== preferredSection) prioritize(approaching.id, true);
    else schedule();
  }
  let scrollFrame;
  window.addEventListener("scroll", () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(updateVisibleSection);
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateVisibleSection();
  });
  schedule();
  return { request, prioritize, replace };
};
