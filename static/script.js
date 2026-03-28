document.addEventListener('DOMContentLoaded', () => {
    let clientId, password, ws, localStream, isMuted = false;
    let iceConfig = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    const peers = {};

    const chat      = document.getElementById('chat');
    const msgInput  = document.getElementById('msg-input');
    const imgInput  = document.getElementById('img-input');
    const meterBar  = document.getElementById('meter-bar');
    const voiceDot  = document.getElementById('voice-dot');
    const vStatus   = document.getElementById('v-status');

    // ── Login ─────────────────────────────────────────────────────
    function tryLogin() {
        clientId = document.getElementById('nick').value.trim();
        password = document.getElementById('pass').value.trim();
        if (clientId && password) initApp();
        else alert('Wpisz nick i hasło!');
    }

    document.getElementById('login-btn').addEventListener('click', tryLogin);
    document.getElementById('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
    document.getElementById('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('pass').focus(); });

    function initApp() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/ws/${encodeURIComponent(clientId)}?pwd=${encodeURIComponent(password)}`);

            ws.onopen = () => {
                console.log('WS połączony');
                // --- NOWE: Heartbeat (Ping) ---
                setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 20000);
            };

            ws.onmessage = async (e) => {
                let data;
                try {
                    data = JSON.parse(e.data);
                } catch (err) { return; }

                if (data.type === 'error') {
                    alert(data.msg);
                    location.reload();
                    return;
                }

                const overlay = document.getElementById('login-overlay');
                if (overlay) overlay.style.display = 'none';

                switch (data.type) {
                    case 'ice-config':
                        // --- NAPRAWA: Bezpieczne przypisanie ---
                        if (data.config && data.config.iceServers) {
                            iceConfig = data.config;
                            console.log('✅ ICE config załadowany');
                        }
                        break;

                case 'user-list':
                    renderUserList(data.users);
                    break;

                case 'text':
                case 'image':
                    appendMessage(data.user, data.text, data.time, data.type);
                    break;

                case 'voice-peers':
                    for (const peerId of data.peers) {
                        if (localStream) await callUser(peerId);
                    }
                    break;

                case 'user-joined':
                    console.log('Dołączył do głosu:', data.userId);
                    break;

                case 'user-left':
                    removePeer(data.userId);
                    break;

                default:
                    await handleSignaling(data);
            }
        };

        ws.onclose = () => appendSystemMessage('Połączenie przerwane. Odśwież stronę.');
        ws.onerror = (err) => console.error('WS błąd:', err);

        msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
        document.getElementById('send-btn').addEventListener('click', sendText);

        imgInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                ws.send(JSON.stringify({ type: 'image', user: clientId, text: ev.target.result }));
            };
            reader.readAsDataURL(file);
            imgInput.value = '';
        });

        setupVoice();
    }

    function sendText() {
        const text = msgInput.value.trim();
        if (!text) return;
        ws.send(JSON.stringify({ type: 'text', user: clientId, text }));
        msgInput.value = '';
    }

    // ── User list ─────────────────────────────────────────────────
    function renderUserList(users) {
        const el = document.getElementById('user-list');
        el.innerHTML = '';
        users.forEach(u => {
            const pill = document.createElement('div');
            pill.className = 'user-pill';
            pill.innerHTML = `<div class="user-dot"></div>${escapeHtml(u)}`;
            el.appendChild(pill);
        });
    }

    // ── Visualizer ────────────────────────────────────────────────
    function startVisualizer(stream) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            document.getElementById('meter-container').style.display = 'block';

            function tick() {
                if (!localStream) return;
                analyser.getByteFrequencyData(data);
                const avg = data.reduce((a, b) => a + b, 0) / data.length;
                meterBar.style.width = Math.min(avg * 2.5, 100) + '%';
                requestAnimationFrame(tick);
            }
            tick();
        } catch (e) { console.warn('Visualizer error:', e); }
    }

    // ── Voice ─────────────────────────────────────────────────────
    function setupVoice() {
        document.getElementById('voice-btn').addEventListener('click', async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                document.getElementById('voice-btn').style.display = 'none';
                document.getElementById('active-controls').style.display = 'flex';
                voiceDot.classList.add('live');
                vStatus.textContent = 'Połączono';
                startVisualizer(localStream);
                ws.send(JSON.stringify({ type: 'user-joined-voice', userId: clientId }));
            } catch (err) {
                console.error('Mikrofon:', err);
                alert('Brak dostępu do mikrofonu.\nUpewnij się że strona działa przez HTTPS!');
            }
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            isMuted = !isMuted;
            if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
            document.getElementById('mute-btn').textContent = isMuted ? 'Wyłącz mute' : 'Wycisz';
            document.getElementById('mute-btn').style.background = isMuted ? 'var(--success)' : 'var(--bg-3)';
        });

        document.getElementById('leave-btn').addEventListener('click', leaveVoice);
    }

    function leaveVoice() {
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        Object.keys(peers).forEach(removePeer);
        ws.send(JSON.stringify({ type: 'user-left-voice', userId: clientId }));
        document.getElementById('voice-btn').style.display = 'block';
        document.getElementById('active-controls').style.display = 'none';
        document.getElementById('meter-container').style.display = 'none';
        voiceDot.classList.remove('live');
        vStatus.textContent = 'Rozłączony';
        meterBar.style.width = '0%';
        isMuted = false;
    }

    // ── WebRTC ────────────────────────────────────────────────────
    function createPC(tid) {
        if (peers[tid]) { peers[tid].close(); delete peers[tid]; }

        // Używamy iceConfig pobranego z serwera (Cloudflare TURN)
        const pc = new RTCPeerConnection(iceConfig);
        peers[tid] = pc;

        if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

        pc.onicecandidate = (e) => {
            if (e.candidate) ws.send(JSON.stringify({ candidate: e.candidate, target: tid, from: clientId }));
        };

        pc.ontrack = (e) => {
            console.log('✅ Audio od:', tid);
            let audio = document.getElementById(`audio-${tid}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${tid}`;
                audio.autoplay = true;
                audio.setAttribute('playsinline', 'true');
                document.body.appendChild(audio);
            }
            audio.srcObject = e.streams[0];
            audio.play().catch(() => {
                document.addEventListener('click', () => audio.play(), { once: true });
            });
        };

        pc.onconnectionstatechange = () => {
            console.log(`Połączenie z ${tid}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed') removePeer(tid);
        };

        return pc;
    }

    async function callUser(id) {
        const pc = createPC(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ offer, target: id, from: clientId }));
    }

    async function handleOffer(offer, id) {
        const pc = createPC(id);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ answer, target: id, from: clientId }));
    }

    function removePeer(id) {
        if (peers[id]) { peers[id].close(); delete peers[id]; }
        const audio = document.getElementById(`audio-${id}`);
        if (audio) audio.remove();
    }

    async function handleSignaling(d) {
        if (d.offer) {
            await handleOffer(d.offer, d.from);
        } else if (d.answer && peers[d.from]) {
            await peers[d.from].setRemoteDescription(new RTCSessionDescription(d.answer));
        } else if (d.candidate && peers[d.from]) {
            try { await peers[d.from].addIceCandidate(new RTCIceCandidate(d.candidate)); }
            catch (e) { console.warn('ICE candidate błąd:', e); }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────
    function appendMessage(u, c, t, type) {
        const d = document.createElement('div');
        d.className = 'msg';
        const content = (type === 'image')
            ? `<img src="${c}" loading="lazy">`
            : `<div class="msg-text">${escapeHtml(c)}</div>`;
        d.innerHTML = `<div class="msg-author">${escapeHtml(u)}<span class="msg-time">${t || ''}</span></div>${content}`;
        chat.appendChild(d);
        chat.scrollTop = chat.scrollHeight;
    }

    function appendSystemMessage(text) {
        const d = document.createElement('div');
        d.className = 'msg msg-system';
        d.textContent = text;
        chat.appendChild(d);
        chat.scrollTop = chat.scrollHeight;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(String(str)));
        return d.innerHTML;
    }
});