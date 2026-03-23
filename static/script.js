document.addEventListener('DOMContentLoaded', () => {
    let clientId, password, ws, localStream, isMuted = false;
    const peers = {};
    const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');
    const imgInput = document.getElementById('img-input');
    const meterBar = document.getElementById('meter-bar');

    document.getElementById('login-btn').onclick = () => {
        clientId = document.getElementById('nick').value.trim();
        password = document.getElementById('pass').value.trim();
        if (clientId && password) initApp();
        else alert("Wpisz nick i hasło!");
    };

    function initApp() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/${encodeURIComponent(clientId)}?pwd=${encodeURIComponent(password)}`);

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'error') { alert(data.msg); location.reload(); return; }
            document.getElementById('login-overlay').style.display = 'none';

            switch(data.type) {
                case 'history': data.messages.forEach(m => appendMessage(m.user, m.text, m.time, m.type)); break;
                case 'user-list': document.getElementById('user-list').innerHTML = data.users.join('<br>'); break;
                case 'text': case 'image': appendMessage(data.user, data.text, data.time, data.type); break;
                case 'user-joined': if (localStream) callUser(data.userId); break;
                case 'user-left': removePeer(data.userId); break;
                default: handleSignaling(data);
            }
        };

        msgInput.onkeypress = (e) => {
            if (e.key === 'Enter' && msgInput.value.trim()) {
                ws.send(JSON.stringify({ type: 'text', user: clientId, text: msgInput.value }));
                msgInput.value = "";
            }
        };

        imgInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                ws.send(JSON.stringify({ type: 'image', user: clientId, text: ev.target.result }));
            };
            reader.readAsDataURL(file);
        };

        setupVoice();
    }

    function startVisualizer(stream) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const src = ctx.createMediaStreamSource(stream);
            const ans = ctx.createAnalyser();
            ans.fftSize = 256;
            src.connect(ans);
            const data = new Uint8Array(ans.frequencyBinCount);

            function update() {
                if (!localStream) return;
                ans.getByteFrequencyData(data);
                let avg = data.reduce((a, b) => a + b) / data.length;
                meterBar.style.width = Math.min(avg * 2.5, 100) + "%";
                requestAnimationFrame(update);
            }
            update();
        } catch (e) { console.error("Visualizer error:", e); }
    }

    async function setupVoice() {
        document.getElementById('voice-btn').onclick = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                document.getElementById('voice-btn').style.display = 'none';
                document.getElementById('active-controls').style.display = 'flex';
                document.getElementById('meter-container').style.display = 'block';
                document.getElementById('v-status').innerText = "Głos: Połączono";

                startVisualizer(localStream);
                ws.send(JSON.stringify({ type: 'user-joined', userId: clientId }));
            } catch (err) {
                alert("Nie można uzyskać dostępu do mikrofonu. Sprawdź ustawienia HTTPS!");
            }
        };

        document.getElementById('mute-btn').onclick = () => {
            isMuted = !isMuted;
            localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
            document.getElementById('mute-btn').innerText = isMuted ? "Wyłącz Mute" : "Wycisz";
            document.getElementById('mute-btn').style.background = isMuted ? "#23a559" : "#4e5058";
        };

        document.getElementById('leave-btn').onclick = () => {
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            localStream = null;
            Object.keys(peers).forEach(removePeer);
            document.getElementById('voice-btn').style.display = 'block';
            document.getElementById('active-controls').style.display = 'none';
            document.getElementById('meter-container').style.display = 'none';
            document.getElementById('v-status').innerText = "Głos: Rozłączony";
        };
    }

    // Znajdź tę funkcję w swoim script.js i podmień ją na tę wersję:
    function createPC(tid) {
        const pc = new RTCPeerConnection(iceConfig);
        peers[tid] = pc;

        if (localStream) {
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        }

        pc.onicecandidate = e => {
            if(e.candidate) ws.send(JSON.stringify({candidate:e.candidate, target:tid, from:clientId}));
        };

        pc.ontrack = (e) => {
            console.log("Otrzymano strumień audio od:", tid);
            let audio = document.getElementById(`audio-${tid}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${tid}`;
                audio.autoplay = true;
                audio.controls = false;
                audio.setAttribute('playsinline', 'true'); // Kluczowe dla iOS
                document.body.appendChild(audio);
            }
            audio.srcObject = e.streams[0];

            // Wymuszenie startu po otrzymaniu tracka
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log("Autoplay zablokowany. Dodaję przycisk odblokowania.");
                    // Jeśli system zablokuje dźwięk, każda wiadomość na czacie go odblokuje
                    document.addEventListener('click', () => audio.play(), { once: true });
                });
            }
        };

        // Monitorowanie stanu połączenia
        pc.onconnectionstatechange = () => {
            console.log("Stan połączenia z", tid, ":", pc.connectionState);
        };

        return pc;
    }

    async function callUser(id) {
        const pc = createPC(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ offer: offer, target: id, from: clientId }));
    }

    async function handleOffer(offer, id) {
        const pc = createPC(id);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ answer: answer, target: id, from: clientId }));
    }

    function removePeer(id) {
        if (peers[id]) peers[id].close();
        delete peers[id];
        const audio = document.getElementById(`audio-${id}`);
        if (audio) audio.remove();
    }

    function handleSignaling(d) {
        if (d.offer) handleOffer(d.offer, d.from);
        else if (d.answer && peers[d.from]) peers[d.from].setRemoteDescription(new RTCSessionDescription(d.answer));
        else if (d.candidate && peers[d.from]) peers[d.from].addIceCandidate(new RTCIceCandidate(d.candidate));
    }

    function appendMessage(u, c, t, type) {
        const d = document.createElement('div');
        d.className = 'msg';
        const content = (type === 'image') ? `<img src="${c}">` : `<span>${c}</span>`;
        d.innerHTML = `<b>${u}<span class="msg-time">${t || ''}</span></b>${content}`;
        chat.appendChild(d);
        chat.scrollTop = chat.scrollHeight;
    }
});