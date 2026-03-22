document.addEventListener('DOMContentLoaded', () => {
    const clientId = "User_" + Math.random().toString(36).substr(2, 4);
    const myIdDisplay = document.getElementById('my-id');
    if (myIdDisplay) myIdDisplay.innerText = "Twoje ID: " + clientId;

    // Ustalanie protokołu WebSocket (ws dla http, wss dla https)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${clientId}`;
    const ws = new WebSocket(wsUrl);

    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');
    const voiceBtn = document.getElementById('voice-btn');

    // Konfiguracja WebRTC (serwery Google STUN)
    const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const peers = {}; 
    let localStream;

    ws.onopen = () => console.log("Połączono z serwerem FastAPI jako " + clientId);

    // --- OBSŁUGA CZATU I SYGNALIZACJI ---
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        // 1. Obsługa tekstu
        if (data.type === 'text') {
            appendMessage(data.user, data.text);
        } 
        // 2. Obsługa WebRTC (Sygnalizacja głosowa)
        else if (data.type === 'user-joined') {
            if (localStream) callUser(data.userId);
        } else if (data.offer) {
            handleOffer(data.offer, data.from);
        } else if (data.answer) {
            peers[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.candidate) {
            peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    };

    // --- FUNKCJE CZATU ---
    msgInput.onkeypress = (e) => {
        if (e.key === 'Enter' && msgInput.value.trim() !== "") {
            const payload = { type: 'text', user: clientId, text: msgInput.value };
            ws.send(JSON.stringify(payload));
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
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voiceBtn.innerText = "Głos: Aktywny 🔊";
            voiceBtn.style.background = "#23a559";
            
            // Poinformuj innych, że jesteśmy gotowi do rozmowy
            ws.send(JSON.stringify({ type: 'user-joined', userId: clientId }));
        } catch (err) {
            console.error("Błąd mikrofonu:", err);
            alert("Nie można uzyskać dostępu do mikrofonu. Użyj localhost lub HTTPS.");
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

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ candidate: event.candidate, target: targetId, from: clientId }));
            }
        };

        pc.ontrack = (event) => {
            const audio = document.createElement('audio');
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            document.body.appendChild(audio);
        };

        return pc;
    }
});