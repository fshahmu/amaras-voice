(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = $('status'), help = $('voiceHelp');
  const start = $('connectVoice'), end = $('endVoice'), mute = $('muteVoice'), play = $('playVoice');
  let active = null;
  const idleHelp = 'Tap Start to speak with Amara. Your microphone is used only during a conversation.';
  function current(call) { return !!call && active === call && !call.cancelled; }
  function cleanup(call = active) {
    if (!call) return;
    call.cancelled = true;
    call.abort.abort();
    clearTimeout(call.timeout);
    clearTimeout(call.disconnectTimer);
    try { call.dc?.close(); } catch {}
    try { call.pc?.close(); } catch {}
    call.stream?.getTracks().forEach(track => track.stop());
    if (call.audio) { call.audio.pause(); call.audio.srcObject = null; call.audio.remove(); }
    if (active === call) {
      active = null;
      start.disabled = false; end.disabled = true; mute.disabled = true;
      mute.textContent = 'Mute microphone'; mute.setAttribute('aria-pressed', 'false');
      play.hidden = true; help.textContent = idleHelp;
    }
  }
  function stop() {
    window.speechSynthesis?.cancel();
    cleanup(); status.textContent = 'Ready when you are.';
  }
  end.onclick = stop;
  $('stop').onclick = stop;
  mute.onclick = () => {
    if (!active?.stream) return;
    active.muted = !active.muted;
    active.stream.getAudioTracks().forEach(track => { track.enabled = !active.muted; });
    mute.textContent = active.muted ? 'Unmute microphone' : 'Mute microphone';
    mute.setAttribute('aria-pressed', String(active.muted));
    status.textContent = active.muted ? 'Microphone muted. You can still hear Amara.' : 'Amara is listening.';
  };
  play.onclick = async () => {
    const call = active;
    try { await call?.audio?.play(); if (current(call)) play.hidden = true; }
    catch { status.textContent = 'Tap Play again to hear Amara.'; }
  };
  $('speak').onclick = () => {
    if (active) { status.textContent = 'End the live conversation before playing the greeting.'; return; }
    if (!('speechSynthesis' in window)) { status.textContent = 'Speech is unavailable in this browser.'; return; }
    speechSynthesis.cancel();
    const greeting = new SpeechSynthesisUtterance("Hello, trouble. I'm Amara. This is our first little beginning.");
    greeting.rate = .88; greeting.pitch = 1.08;
    const preferred = speechSynthesis.getVoices().find(v => /Samantha|Ava|Serena|female/i.test(v.name) && v.lang.startsWith('en'));
    if (preferred) greeting.voice = preferred;
    greeting.onstart = () => { status.textContent = 'Speaking…'; };
    greeting.onend = () => { if (!active) status.textContent = 'Ready when you are.'; };
    speechSynthesis.speak(greeting);
  };
  async function sessionError(response) {
    if (response.redirected || !response.headers.get('Content-Type')?.includes('application/json')) {
      return 'Your sign-in expired. Reload this page and sign in again.';
    }
    if (response.status === 401 || response.status === 403) return 'Please reload this page and sign in again.';
    if (response.status === 429) return 'Please wait a minute before starting another conversation.';
    if (response.status === 503) return 'Voice setup is incomplete. Your microphone is off. The test service needs its secure configuration checked.';
    return 'Amara could not connect. Please try again shortly.';
  }
  start.onclick = async () => {
    if (active) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      status.textContent = 'Open this page in Safari or Chrome over HTTPS to use live voice.'; return;
    }
    window.speechSynthesis?.cancel();
    const call = { abort: new AbortController(), muted: false, cancelled: false };
    active = call; start.disabled = true; end.disabled = false;
    status.textContent = 'Checking your secure connection…';
    call.timeout = setTimeout(() => {
      if (!current(call)) return;
      cleanup(call); status.textContent = 'Connection timed out. Tap Start to try again.';
    }, 45000);
    try {
      // Readiness never creates a paid session or requests microphone permission.
      const ready = await fetch('/api/voice-status', { credentials: 'same-origin', cache: 'no-store', signal: call.abort.signal });
      if (!current(call)) return;
      if (!ready.ok || ready.redirected || !ready.headers.get('Content-Type')?.includes('application/json')) throw new Error(await sessionError(ready));
      status.textContent = 'Allow your microphone to begin.';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!current(call)) { stream.getTracks().forEach(track => track.stop()); return; }
      call.stream = stream; mute.disabled = false;
      call.pc = new RTCPeerConnection();
      stream.getAudioTracks().forEach(track => call.pc.addTrack(track, stream));
      call.audio = document.createElement('audio');
      call.audio.autoplay = true; call.audio.setAttribute('playsinline', ''); call.audio.hidden = true;
      document.body.append(call.audio);
      call.pc.ontrack = event => {
        if (!current(call)) return;
        call.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        call.audio.play().catch(() => { if (current(call)) { play.hidden = false; status.textContent = 'Tap Play Amara’s audio to hear her.'; } });
      };
      call.pc.onconnectionstatechange = () => {
        if (!current(call)) return;
        clearTimeout(call.disconnectTimer);
        if (call.pc.connectionState === 'failed' || call.pc.connectionState === 'closed') {
          cleanup(call); status.textContent = 'Connection ended. Tap Start to reconnect.';
        } else if (call.pc.connectionState === 'disconnected') {
          status.textContent = 'Connection interrupted…';
          call.disconnectTimer = setTimeout(() => { if (current(call)) { cleanup(call); status.textContent = 'Connection ended. Tap Start to reconnect.'; } }, 5000);
        } else if (call.pc.connectionState === 'connected') {
          status.textContent = call.muted ? 'Microphone muted.' : 'Amara is listening.';
        }
      };
      call.dc = call.pc.createDataChannel('oai-events');
      call.dc.onopen = () => {
        if (!current(call)) return;
        clearTimeout(call.timeout);
        status.textContent = call.muted ? 'Microphone muted.' : 'Amara is listening.';
        help.textContent = 'Conversation connected. Mute pauses your microphone; End turns it off.';
      };
      call.dc.onmessage = ({ data }) => {
        if (!current(call)) return;
        let event; try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'error') { cleanup(call); status.textContent = 'The voice service reported an error. Tap Start to reconnect.'; }
        else if (event.type === 'output_audio_buffer.started') status.textContent = 'Amara is speaking…';
        else if (event.type === 'output_audio_buffer.stopped' || event.type === 'input_audio_buffer.speech_stopped') status.textContent = call.muted ? 'Microphone muted.' : 'Amara is listening.';
        else if (event.type === 'input_audio_buffer.speech_started') status.textContent = call.muted ? 'Microphone muted.' : 'Listening to you…';
      };
      call.dc.onclose = () => { if (current(call)) { cleanup(call); status.textContent = 'Conversation ended.'; } };
      const offer = await call.pc.createOffer();
      if (!current(call)) return;
      await call.pc.setLocalDescription(offer);
      if (!current(call)) return;
      // Request the short-lived credential after microphone permission and SDP preparation.
      const session = await fetch('/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store', signal: call.abort.signal });
      if (!current(call)) return;
      if (!session.ok || session.redirected || !session.headers.get('Content-Type')?.includes('application/json')) throw new Error(await sessionError(session));
      const payload = await session.json();
      if (!current(call)) return;
      const ephemeral = payload?.client_secret?.value;
      if (typeof ephemeral !== 'string' || !ephemeral) throw new Error('Amara could not create a secure voice connection.');
      status.textContent = 'Connecting to Amara…';
      const answer = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: 'Bearer ' + ephemeral, 'Content-Type': 'application/sdp' }, body: call.pc.localDescription.sdp, signal: call.abort.signal });
      if (!current(call)) return;
      if (!answer.ok) throw new Error('The voice connection was rejected. Please try again shortly.');
      const sdp = await answer.text();
      if (!current(call)) return;
      await call.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      if (!current(call)) return;
      cleanup(call);
      status.textContent = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in browser settings, then tap Start.' : error.message || 'Unable to connect.';
    }
  };
  window.addEventListener('pagehide', stop);
})();
