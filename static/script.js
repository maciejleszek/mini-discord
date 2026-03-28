document.addEventListener('DOMContentLoaded', () => {
    let clientId, password, ws, localStream, isMuted = false;
    const peers = {};

    // ---------------------------------------------------------------
    // KONFIGURACJA ICE — STUN + TURN
    // Zarejestruj się na https://www.metered.ca/tools/openrelay/ (darmowe)
    // i zastąp poniższe dane swoimi credentials z panelu Metered.
    // Bez serwera TURN głos NIE będzie działał przez NAT/firewalle!
    // ---------------------------------------------------------------
    const iceConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    };

    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');
    const imgInput = document.getElementById('img-input');
    const meterBar = document.getElementById('meter-bar');

    // Logowanie
    document.getElementById('login-btn').onclick = () => {
        clientId = document.getElementById('nick').value.trim();
        password = document.getElementById('pass').value.trim();
        if (clientId && password) initApp();
        else alert("Wpisz nick i hasło!");
    };

    document.getElementById('pass').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('login-btn').click();
    });

    function initApp() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/${encodeURIComponent(clientId)}?pwd=${encodeURIComponent(password)}`);

        ws.onopen = () => console.log("WebSocket połączony");

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'error') {
                alert(data.msg);
                location.reload();
                return;
            }

            // Ukryj overlay po pierwszej poprawnej wiadomości
            document.getElementById('login-overlay').style.display = 'none';

            switch (data.type) {
                case 'history':
                    data.messages.forEach(m => appendMessage(m.user, m.text, m.time, m.type));
                    break;

                case 'user-list':
                    document.getElementById('user-list').innerHTML = data.users.join('<br>');
                    break;

                case 'text':
                case 'image':
                    appendMessage(data.user, data.text, data.time, data.type);
                    break;

                // Serwer zwraca listę użytkowników już będących w kanale głosowym
                // — tylko MY inicjujemy do nich połączenie (unikamy duplikatów)
                case 'voice-peers':
                    for (const peerId of data.peers) {
                        if (localStream) await callUser(peerId);
                    }
                    break;

                // Ktoś nowy dołączył do głosu — on zainicjuje do nas połączenie,
                // my tylko czekamy na offer (nic nie robimy tutaj)
                case 'user-joined':
                    console.log("Użytkownik dołączył do głosu:", data.userId);
                    break;

                case 'user-left':
                    removePeer(data.userId);
                    break;

                default:
                    handleSignaling(data);
            }
        };

        ws.onclose = () => {
            console.log("WebSocket rozłączony");
            appendSystemMessage("Połączenie przerwane. Odśwież stronę.");
        };

        ws.onerror = (err) => {
            console.error("WebSocket błąd:", err);
        };

        // Wysyłanie wiadomości tekstowych — Enter
        msgInput.onkeypress = (e) => {
            if (e.key === 'Enter') sendTextMessage();
        };

        // Przycisk Wyślij (mobile)
        document.getElementById('send-btn').onclick = sendTextMessage;

        // Wysyłanie obrazów
        imgInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                ws.send(JSON.stringify({ type: 'image', user: clientId, text: ev.target.result }));
            };
            reader.readAsDataURL(file);
            imgInput.value = '';
        };

        setupVoice();
    }

    function sendTextMessage() {
        const text = msgInput.value.trim();
        if (!text) return;
        ws.send(JSON.stringify({ type: 'text', user: clientId, text }));
        msgInput.value = '';
    }

    // Wizualizator mikrofonu
    function startVisualizer(stream) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);

            function update() {
                if (!localStream) return;
                analyser.getByteFrequencyData(data);
                const avg = data.reduce((a, b) => a + b, 0) / data.length;
                meterBar.style.width = Math.min(avg * 2.5, 100) + '%';
                requestAnimationFrame(update);
            }
            update();
        } catch (e) {
            console.error("Visualizer error:", e);
        }
    }

    function setupVoice() {
        document.getElementById('voice-btn').onclick = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

                document.getElementById('voice-btn').style.display = 'none';
                document.getElementById('active-controls').style.display = 'flex';
                document.getElementById('meter-container').style.display = 'block';
                document.getElementById('v-status').innerText = 'Głos: Połączono ✅';

                startVisualizer(localStream);

                // Informujemy serwer — serwer odpowie listą peers już w kanale
                ws.send(JSON.stringify({ type: 'user-joined-voice', userId: clientId }));

            } catch (err) {
                console.error("Mikrofon błąd:", err);
                alert("Nie można uzyskać dostępu do mikrofonu.\nUpewnij się że strona działa przez HTTPS!");
            }
        };

        document.getElementById('mute-btn').onclick = () => {
            isMuted = !isMuted;
            if (localStream) {
                localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
            }
            document.getElementById('mute-btn').innerText = isMuted ? 'Wyłącz Mute 🔈' : 'Wycisz 🔇';
            document.getElementById('mute-btn').style.background = isMuted ? '#23a559' : '#4e5058';
        };

        document.getElementById('leave-btn').onclick = () => {
            leaveVoice();
        };
    }

    function leaveVoice() {
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        Object.keys(peers).forEach(removePeer);

        ws.send(JSON.stringify({ type: 'user-left-voice', userId: clientId }));

        document.getElementById('voice-btn').style.display = 'block';
        document.getElementById('active-controls').style.display = 'none';
        document.getElementById('meter-container').style.display = 'none';
        document.getElementById('v-status').innerText = 'Głos: Rozłączony';
        meterBar.style.width = '0%';
        isMuted = false;
    }

    // Tworzenie RTCPeerConnection
    function createPC(tid) {
        if (peers[tid]) {
            peers[tid].close();
            delete peers[tid];
        }

        const pc = new RTCPeerConnection(iceConfig);
        peers[tid] = pc;

        if (localStream) {
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        }

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                ws.send(JSON.stringify({ candidate: e.candidate, target: tid, from: clientId }));
            }
        };

        pc.ontrack = (e) => {
            console.log("✅ Otrzymano strumień audio od:", tid);
            let audio = document.getElementById(`audio-${tid}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${tid}`;
                audio.autoplay = true;
                audio.setAttribute('playsinline', 'true');
                document.body.appendChild(audio);
            }
            audio.srcObject = e.streams[0];

            audio.play().catch(err => {
                console.warn("Autoplay zablokowany, czekam na interakcję użytkownika:", err);
                // Odblokuj po pierwszym kliknięciu
                const unlock = () => { audio.play(); document.removeEventListener('click', unlock); };
                document.addEventListener('click', unlock);
            });
        };

        pc.onconnectionstatechange = () => {
            console.log(`Połączenie z ${tid}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed') {
                console.warn(`Połączenie z ${tid} nie powiodło się. Spróbuj ponownie.`);
                removePeer(tid);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`ICE z ${tid}: ${pc.iceConnectionState}`);
        };

        return pc;
    }

    // My inicjujemy — wysyłamy offer
    async function callUser(id) {
        console.log("Dzwonię do:", id);
        const pc = createPC(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ offer: offer, target: id, from: clientId }));
    }

    // Ktoś zadzwonił do nas — odpowiadamy answer
    async function handleOffer(offer, id) {
        console.log("Odbieram offer od:", id);
        const pc = createPC(id);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ answer: answer, target: id, from: clientId }));
    }

    function removePeer(id) {
        if (peers[id]) {
            peers[id].close();
            delete peers[id];
        }
        const audio = document.getElementById(`audio-${id}`);
        if (audio) audio.remove();
        console.log("Usunięto peera:", id);
    }

    async function handleSignaling(d) {
        if (d.offer) {
            await handleOffer(d.offer, d.from);
        } else if (d.answer && peers[d.from]) {
            await peers[d.from].setRemoteDescription(new RTCSessionDescription(d.answer));
        } else if (d.candidate && peers[d.from]) {
            try {
                await peers[d.from].addIceCandidate(new RTCIceCandidate(d.candidate));
            } catch (e) {
                console.warn("Błąd dodawania ICE candidate:", e);
            }
        }
    }

    function appendMessage(u, c, t, type) {
        const d = document.createElement('div');
        d.className = 'msg';
        const content = (type === 'image') ? `<img src="${c}" loading="lazy">` : `<span>${escapeHtml(c)}</span>`;
        d.innerHTML = `<b>${escapeHtml(u)}<span class="msg-time">${t || ''}</span></b>${content}`;
        chat.appendChild(d);
        chat.scrollTop = chat.scrollHeight;
    }

    function appendSystemMessage(text) {
        const d = document.createElement('div');
        d.className = 'msg';
        d.style.background = '#2a2a2a';
        d.style.color = '#949ba4';
        d.style.fontStyle = 'italic';
        d.innerHTML = `<span>⚠️ ${escapeHtml(text)}</span>`;
        chat.appendChild(d);
        chat.scrollTop = chat.scrollHeight;
    }

    // Zabezpieczenie przed XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }
});