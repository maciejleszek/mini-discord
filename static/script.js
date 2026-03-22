document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicjalizacja i ID
    const clientId = "User_" + Math.random().toString(36).substr(2, 4);
    const myIdDisplay = document.getElementById('my-id');
    if (myIdDisplay) myIdDisplay.innerText = "Twoje ID: " + clientId;

    // 2. Połączenie WebSocket (obsługuje czat i sygnalizację WebRTC)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${clientId}`;
    const ws = new WebSocket(wsUrl);

    // 3. Elementy DOM
    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');
    const userListDiv = document.getElementById('user-list');
    const voiceBtn = document.getElementById('voice-btn');
    const muteBtn = document.getElementById('mute-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const activeControls = document.getElementById('active-controls');

    // 4. Konfiguracja WebRTC
    const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const peers = {};
    let localStream;
    let isMuted = false;

    // --- OBSŁUGA KOMUNIKACJI ---
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch(data.type) {
            case 'history':
                // Ładowanie starych wiadomości z bazy przy wejściu
                chat.innerHTML = "";
                data.messages.forEach(m => appendMessage(m.user, m.text));
                break;

            case 'user-list':
                // Automatyczna aktualizacja listy osób bez odświeżania strony
                userListDiv.innerHTML = "<b>Online:</b> " + data.users.join(', ');
                break;

            case 'text':
                // Odbieranie nowej wiadomości (jeśli nie od nas)
                if (data.user !== clientId) appendMessage(data.user, data.text);
                break;

            case 'user-joined':
                console.log("Nowy użytkownik w kanale głosowym:", data.userId);
                if (localStream) callUser(data.userId);
                break;

            case 'user-left':
                // Sprzątanie po osobie, która wyszła
                if (peers[data.userId]) {
                    peers[data.userId].close();
                    delete peers[data.userId];
                    const audioEl = document.getElementById(`audio-${data.userId}`);
                    if (audioEl) audioEl.remove();
                }
                break;

            // Sygnalizacja WebRTC (Negocjacja połączenia)
            default:
                if (data.offer) {
                    handleOffer(data.offer, data.from);
                } else if (data.answer) {
                    if (peers[data.from]) await peers[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
                } else if (data.candidate) {
                    if (peers[data.from]) await peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
                }
        }
    };

    // --- FUNKCJE CZATU ---
    msgInput.onkeypress = (e) => {
        if (e.key === 'Enter' && msgInput.value.trim() !== "") {
            const text = msgInput.value;
            ws.send(JSON.stringify({ type: 'text', user: clientId, text: text }));
            appendMessage("Ty", text); // Dodaj natychmiast u siebie
            msgInput.value = "";
        }
    };

    function appendMessage(user, text) {
        const div = document.createElement('div');
        div.className = 'msg';
        div.innerHTML = `<b>${user}:</b> ${text}`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight; // Auto-scroll
    }

    // --- KONTROLA GŁOSU ---
    voiceBtn.onclick = async () => {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voiceBtn.style.display = 'none';
            activeControls.style.display = 'flex';

            // Poinformuj innych, że dołączyłeś do rozmowy
            ws.send(JSON.stringify({ type: 'user-joined', userId: clientId }));
        } catch (err) {
            console.error(err);
            alert("Błąd mikrofonu. Safari wymaga HTTPS lub localhost.");
        }
    };

    muteBtn.onclick = () => {
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;
        muteBtn.innerText = isMuted ? "Włącz Mikrofon" : "Wycisz Mikrofon";
        muteBtn.style.background = isMuted ? "#23a559" : "#4e5058";
    };

    leaveBtn.onclick = () => {
        // Wyłącz sprzętowo mikrofon
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;

        // Zamknij połączenia ze wszystkimi
        Object.keys(peers).forEach(id => {
            peers[id].close();
            delete peers[id];
            const audio = document.getElementById(`audio-${id}`);
            if (audio) audio.remove();
        });

        activeControls.style.display = 'none';
        voiceBtn.style.display = 'block';

        // Poinformuj serwer o wyjściu z głosu
        ws.send(JSON.stringify({ type: 'user-left', userId: clientId }));
    };

    // --- LOGIKA WebRTC ---
    async function callUser(targetId) {
        const pc = createPeerConnection(targetId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ offer, target: targetId, from: clientId }));
    }

    async function handleOffer(offer, fromId) {
        const pc = createPeerConnection(fromId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ answer, target: fromId, from: clientId }));
    }

    function createPeerConnection(targetId) {
        const pc = new RTCPeerConnection(iceConfig);
        peers[targetId] = pc;

        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ candidate: event.candidate, target: targetId, from: clientId }));
            }
        };

        pc.ontrack = (event) => {
            let audio = document.getElementById(`audio-${targetId}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${targetId}`;
                audio.autoplay = true;
                document.body.appendChild(audio);
            }
            audio.srcObject = event.streams[0];
        };

        return pc;
    }
});