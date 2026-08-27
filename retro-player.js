// Retro Windows media player — editorial.html's 3D room only.
// Play/pause, a draggable seek bar, and a running time display, all
// wired to one real <audio> element. The scrolling track-title marquee
// is pure CSS (see .retro-player-track in styles.css); this only
// touches the parts an <audio> element actually needs JS for.

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function initRetroPlayer() {
    const audio = document.getElementById('retroAudio');
    const playBtn = document.getElementById('retroPlayBtn');
    const seek = document.getElementById('retroSeek');
    const timeEl = document.getElementById('retroTime');
    if (!audio || !playBtn || !seek || !timeEl) return;

    const SEEK_MAX = 1000;
    let userIsSeeking = false;

    function updateDisplay() {
        const duration = audio.duration || 0;
        timeEl.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
        if (duration && !userIsSeeking) {
            seek.value = String((audio.currentTime / duration) * SEEK_MAX);
        }
    }

    playBtn.addEventListener('click', () => {
        if (audio.paused) audio.play();
        else audio.pause();
    });

    audio.addEventListener('play', () => {
        playBtn.textContent = '⏸'; // pause glyph
        playBtn.setAttribute('aria-label', 'Pause');
    });
    audio.addEventListener('pause', () => {
        playBtn.textContent = '▶'; // play glyph
        playBtn.setAttribute('aria-label', 'Play');
    });
    audio.addEventListener('ended', () => {
        playBtn.textContent = '▶';
        playBtn.setAttribute('aria-label', 'Play');
    });
    audio.addEventListener('timeupdate', updateDisplay);
    audio.addEventListener('loadedmetadata', updateDisplay);

    // Live-scrub while dragging, but don't fight the drag with
    // timeupdate's own seek.value writes until the user lets go.
    seek.addEventListener('input', () => {
        userIsSeeking = true;
        const duration = audio.duration || 0;
        if (duration) audio.currentTime = (Number(seek.value) / SEEK_MAX) * duration;
        updateDisplay();
    });
    seek.addEventListener('change', () => { userIsSeeking = false; });
}

initRetroPlayer();
