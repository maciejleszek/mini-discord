document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicjalizacja danych użytkownika
    const clientId = "User_" + Math.random().toString(36).substr(2, 4);
    const myIdDisplay = document.getElementById('my-id');
    if (myIdDisplay) myIdDisplay.innerText = "Twoje ID: " + clientId;

    // 2. Połączenie z WebSocketem
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${clientId}`;
    const ws = new WebSocket(wsUrl);

    // 3. Elementy DOM
    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');
    const voiceBtn = document.getElementById('voice-btn');

    // Tworzymy kontener na listę osób online, jeśli nie istnieje
    let userListDiv = document.getElementById('user-list');
    if (!userListDiv) {
        userListDiv = document.createElement('div');
        userListDiv.id = 'user-list';
        userListDiv.style = "font-size: 0.8rem; color: #23a559; margin-bottom: 15px; padding: 10px; background: #1e1f22; border-radius: 4px;";
        document.querySelector('.sidebar').prepend(userListDiv);
    }

    // 4. Konfiguracja WebRTC
    const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const peers = {};
    let localStream;

    ws.onopen = () => console.log("Połączono z serwerem jako: " + clientId);

    // --- OBSŁUGA KOMUNIKACJI (WebSocket) ---
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch(data.type) {
            case 'user-list':
                userListDiv.innerHTML = "<b>Online:</b><br>" + data.users.join('<br>');
                break;

            case 'text':
                appendMessage(data.user, data.text);
                break;

            case 'user-joined':
                console.log("Nowa osoba dołączyła:", data.userId);
                // Jeśli my mamy włączony mikrofon, dzwonimy do nowej osoby
                if (localStream) callUser(data.userId);
                break;

            case 'user-left':
                if (peers[data.userId]) {
                    peers[data.userId].close();
                    delete peers[data.userId];
                    const audioEl = document.getElementById(`audio-${data.userId}`);
                    if (audioEl) audioEl.remove();
                }
                break;

            // Sygnalizacja WebRTC (negocjacja połączenia)
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
            ws.send(JSON.stringify({ type: 'text', user: clientId, text: msgInput.value }));
            appendMessage("Ty", msgInput.value);
            msgInput.value = "";
        }
    };

    function appendMessage(user, text) {
        const div = document.createElement('div');
        div.className = 'msg';
        div.innerHTML = `<b>${user}:</b> ${text}`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    // --- FUNKCJE GŁOSOWE (WebRTC) ---
    voiceBtn.onclick = async () => {
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                voiceBtn.innerText = "Głos: ON 🔊";
                voiceBtn.style.background = "#23a559";

                // Po aktywacji mikrofonu wysyłamy info do serwera, by inni nas "usłyszeli"
                ws.send(JSON.stringify({ type: 'user-joined', userId: clientId }));
            } catch (err) {
                alert("Błąd mikrofonu! Safari wymaga HTTPS lub localhost.");
            }
        }
    };

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

        // Dodaj nasz głos do połączenia
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        // Wysyłanie kandydatów sieciowych (ICE)
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ candidate: event.candidate, target: targetId, from: clientId }));
            }
        };

        // Odbieranie głosu od kolegi
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