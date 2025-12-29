// public/js/player.js
(function () {
  const bootEl = document.getElementById("boot");
  if (!bootEl) return;

  const boot = JSON.parse(bootEl.textContent || "{}");
  const code = boot.code;
  const lang = boot.lang || "en";
  const episodes = Array.isArray(boot.episodes) ? boot.episodes : [];
  let currentEpisode = Number(boot.initialEpisode || 1) || 1;

  const video = document.getElementById("video");
  const playerWrap = document.getElementById("playerWrap");
  const controls = document.getElementById("controls");
  const btnPlay = document.getElementById("btnPlay");
  const centerPlay = document.getElementById("centerPlay");
  const timeNow = document.getElementById("timeNow");
  const timeDur = document.getElementById("timeDur");

  const progressTrack = document.getElementById("progressTrack");
  const progressFill = document.getElementById("progressFill");
  const progressHover = document.getElementById("progressHover");

  const vol = document.getElementById("vol");
  const qualitySel = document.getElementById("quality");

  const toggleEpisodesBtn = document.getElementById("toggleEpisodesBtn");
  const toggleFullscreenBtn = document.getElementById("toggleFullscreenBtn");

  const drawer = document.getElementById("episodesDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const closeEpisodesBtn = document.getElementById("closeEpisodesBtn");
  const episodesList = document.getElementById("episodesList");
  const hint = document.getElementById("hint");

  if (!video || !playerWrap) return;

  // Never show native controls
  video.controls = false;

  let hls = null;
  let hideTimer = null;
  let lastMove = Date.now();
  let lastLoadedUrl = null;

  function fmtTime(s) {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function setControlsVisible(visible) {
    controls.style.opacity = visible ? "1" : "0";
    controls.style.pointerEvents = visible ? "auto" : "none";
    if (visible) {
      playerWrap.classList.remove("cursor-none");
    } else {
      playerWrap.classList.add("cursor-none");
    }
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const idle = Date.now() - lastMove;
      if (!video.paused && idle > 1600) setControlsVisible(false);
    }, 1700);
  }

  function showControlsBriefly() {
    lastMove = Date.now();
    setControlsVisible(true);
    scheduleHide();
  }

  function showCenterPlay(show) {
    centerPlay.style.opacity = show ? "1" : "0";
    centerPlay.style.pointerEvents = show ? "auto" : "none";
  }

  function setPlayLabel() {
    btnPlay.textContent = video.paused ? "Play" : "Pause";
    showCenterPlay(video.paused);
  }

  function updateTimes() {
    timeNow.textContent = fmtTime(video.currentTime);
    timeDur.textContent = fmtTime(video.duration);
  }

  function updateProgress() {
    const dur = video.duration;
    const t = video.currentTime;
    const pct = dur > 0 ? (t / dur) * 100 : 0;
    progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function attachHls(url, qualityPreference) {
    // If same URL, don't recreate
    if (lastLoadedUrl === url && hls) return;

    lastLoadedUrl = url;

    // Clean up previous
    if (hls) {
      try { hls.destroy(); } catch {}
      hls = null;
    }

    // Safari may support native HLS
    const canNative = video.canPlayType("application/vnd.apple.mpegurl");

    if (canNative) {
      video.src = url;
      return;
    }

    if (!window.Hls) {
      console.error("Hls.js not loaded");
      video.src = url;
      return;
    }

    if (!window.Hls.isSupported()) {
      console.error("Hls not supported in this browser");
      video.src = url;
      return;
    }

    hls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });

    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      // Best-effort: apply a "qualityPreference" if the manifest supports multiple levels.
      // But since the API gives separate 720/1080 URLs, we mainly switch by URL.
      if (qualityPreference && qualityPreference !== "auto") {
        // try to select a matching level height
        const desired = Number(qualityPreference);
        if (Number.isFinite(desired)) {
          const levels = hls.levels || [];
          const idx = levels.findIndex(l => l.height === desired);
          if (idx >= 0) hls.currentLevel = idx;
        }
      }
    });

    hls.on(window.Hls.Events.ERROR, (evt, data) => {
      // Non-fatal network errors can happen; keep UX stable.
      if (data && data.fatal) {
        console.warn("Fatal HLS error:", data);
      }
    });
  }

  function pickUrlFromPlay(play, quality) {
    const v1080 = play && play.video_1080;
    const v720 = play && play.video_720;

    if (quality === "1080") return v1080 || v720;
    if (quality === "720") return v720 || v1080;
    // auto: prefer best available
    return v1080 || v720;
  }

  async function fetchPlay(ep) {
    const res = await fetch(`/api/play/${encodeURIComponent(code)}?ep=${encodeURIComponent(ep)}&lang=${encodeURIComponent(lang)}`);
    const json = await res.json();
    if (!json || !json.ok) throw new Error(json?.error || "Play request failed");
    return json.play;
  }

  async function loadEpisode(ep, { autoplay = true, preserveTime = false } = {}) {
    currentEpisode = ep;

    // UI: mark active
    renderEpisodes();

    showControlsBriefly();

    const prevTime = preserveTime ? (video.currentTime || 0) : 0;
    const wasPlaying = !video.paused;

    // Fetch play
    const play = await fetchPlay(ep);

    // Choose URL based on quality dropdown
    const q = qualitySel.value || "auto";
    const url = pickUrlFromPlay(play, q);

    if (!url) throw new Error("No playable HLS URL found");

    attachHls(url, q);

    // Once metadata is ready, optionally restore time
    const onLoaded = async () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      if (preserveTime && Number.isFinite(prevTime) && prevTime > 0 && video.duration && prevTime < video.duration - 2) {
        try { video.currentTime = prevTime; } catch {}
      }
      if (autoplay || wasPlaying) {
        try { await video.play(); } catch {}
      }
      setPlayLabel();
      updateTimes();
      updateProgress();
    };
    video.addEventListener("loadedmetadata", onLoaded);

    // Update URL state without reload
    const u = new URL(window.location.href);
    u.searchParams.set("ep", String(ep));
    u.searchParams.set("lang", lang);
    window.history.replaceState({}, "", u.toString());
  }

  function renderEpisodes() {
    if (!episodesList) return;

    if (!episodes.length) {
      episodesList.innerHTML = `
        <div class="p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70">
          No episode list available. You can still try changing <span class="text-white">?ep=</span> in the URL.
        </div>
      `;
      return;
    }

    // The API shape may vary; we support:
    // - array of numbers
    // - array of objects with ep/episode/number + name/title
    // - array of strings
    const normalized = episodes.map((e, idx) => {
      if (typeof e === "number") return { ep: e, label: `Episode ${e}` };
      if (typeof e === "string") {
        const n = Number(e);
        return { ep: Number.isFinite(n) ? n : (idx + 1), label: `Episode ${e}` };
      }
      if (e && typeof e === "object") {
        const ep = Number(e.ep ?? e.episode ?? e.number ?? (idx + 1)) || (idx + 1);
        const label = (e.name || e.title) ? `${e.name || e.title}` : `Episode ${ep}`;
        return { ep, label };
      }
      return { ep: idx + 1, label: `Episode ${idx + 1}` };
    });

    episodesList.innerHTML = normalized.map(item => {
      const active = item.ep === currentEpisode;
      return `
        <button data-ep="${item.ep}"
          class="w-full text-left p-3 rounded-xl border transition
            ${active ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/15"}">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold truncate">${item.label}</div>
              <div class="text-xs text-white/55">Episode ${item.ep}</div>
            </div>
            ${active ? `<span class="text-xs px-2 py-1 rounded-full bg-cs-accent text-white font-semibold">Playing</span>` : ""}
          </div>
        </button>
      `;
    }).join("");

    episodesList.querySelectorAll("button[data-ep]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ep = Number(btn.getAttribute("data-ep") || 1) || 1;
        try {
          await loadEpisode(ep, { autoplay: true, preserveTime: false });
          closeDrawer();
        } catch (e) {
          console.error(e);
          alert("Failed to load episode. Try again.");
        }
      });
    });
  }

  function openDrawer() {
    if (!drawer || !drawerBackdrop) return;
    drawer.classList.remove("translate-x-full");
    drawerBackdrop.classList.remove("hidden");
  }

  function closeDrawer() {
    if (!drawer || !drawerBackdrop) return;
    drawer.classList.add("translate-x-full");
    drawerBackdrop.classList.add("hidden");
  }

  // ----- Events -----
  playerWrap.addEventListener("mousemove", () => showControlsBriefly(), { passive: true });
  playerWrap.addEventListener("touchstart", () => showControlsBriefly(), { passive: true });

  centerPlay.addEventListener("click", async () => {
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {}
  });

  btnPlay.addEventListener("click", async () => {
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {}
  });

  video.addEventListener("play", setPlayLabel);
  video.addEventListener("pause", setPlayLabel);
  video.addEventListener("timeupdate", () => {
    updateTimes();
    updateProgress();
  });
  video.addEventListener("durationchange", () => {
    updateTimes();
    updateProgress();
  });

  // Progress seek
  function seekAt(clientX) {
    const rect = progressTrack.getBoundingClientRect();
    const pct = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, pct));
    const dur = video.duration || 0;
    if (dur > 0) {
      try { video.currentTime = clamped * dur; } catch {}
    }
  }

  progressTrack.addEventListener("mousemove", (e) => {
    const rect = progressTrack.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, pct));
    progressHover.style.width = `${clamped * 100}%`;
    progressHover.style.opacity = "1";
  });

  progressTrack.addEventListener("mouseleave", () => {
    progressHover.style.opacity = "0";
  });

  progressTrack.addEventListener("click", (e) => {
    seekAt(e.clientX);
  });

  // Volume
  vol.addEventListener("input", () => {
    video.volume = Number(vol.value);
  });
  video.volume = Number(vol.value);

  // Quality: since API provides separate URLs, we reload source while preserving time
  qualitySel.addEventListener("change", async () => {
    try {
      await loadEpisode(currentEpisode, { autoplay: !video.paused, preserveTime: true });
    } catch (e) {
      console.error(e);
    }
  });

  // Drawer
  toggleEpisodesBtn && toggleEpisodesBtn.addEventListener("click", openDrawer);
  closeEpisodesBtn && closeEpisodesBtn.addEventListener("click", closeDrawer);
  drawerBackdrop && drawerBackdrop.addEventListener("click", closeDrawer);

  // Fullscreen
  toggleFullscreenBtn && toggleFullscreenBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await playerWrap.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  });

  // Hint + idle cursor behavior
  (function initIdleUX() {
    let first = true;
    setControlsVisible(true);
    showCenterPlay(true);

    playerWrap.addEventListener("mousemove", () => {
      if (first) {
        first = false;
        hint && (hint.classList.remove("hidden"));
        setTimeout(() => hint && hint.classList.add("hidden"), 1800);
      }
    }, { passive: true });
  })();

  // Initial render + initial load
  renderEpisodes();

  (async function bootLoad() {
    try {
      // If server provided initial play, use it; else fetch
      const initialPlay = boot.play || null;

      const q = qualitySel.value || "auto";
      const url = initialPlay ? pickUrlFromPlay(initialPlay, q) : null;

      if (url) {
        attachHls(url, q);
      } else {
        await loadEpisode(currentEpisode, { autoplay: false, preserveTime: false });
      }

      setPlayLabel();
      updateTimes();
      updateProgress();
      showControlsBriefly();
    } catch (e) {
      console.error(e);
      alert("Failed to initialize playback.");
    }
  })();
})();
