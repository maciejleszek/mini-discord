document.addEventListener('DOMContentLoaded', () => {
    const clientId = "User_" + Math.random().toString(36).substr(2, 4);
    const myIdDisplay = document.getElementById('my-id');
    if (myIdDisplay) myIdDisplay.innerText = "Twoje ID: " + clientId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${clientId}`);

    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');

    // Przyciski
    const voiceBtn = document.getElementById('voice-btn');
    const muteBtn = document.getElementById('mute-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const controlsDiv = document.getElementById('active-controls');

    const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const peers = {};
    let localStream;
    let isMuted = false;

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        switch(data.type) {
            case 'user-list':
                updateUserList(data.users);
                break;
            case 'text':
                appendMessage(data.user, data.text);
                break;
            case 'user-joined':
                if (localStream) callUser(data.userId);
                break;
            case 'user-left':
                removePeer(data.userId);
                break;
            default:
                if (data.offer) handleOffer(data.offer, data.from);
                else if (data.answer && peers[data.from]) peers[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
                else if (data.candidate && peers[data.from]) peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    };

    function updateUserList(users) {
        let listDiv = document.getElementById('user-list');
        if (!listDiv) {
            listDiv = document.createElement('div');
            listDiv.id = 'user-list';
            listDiv.style = "font-size: 0.8rem; color: #23a559; margin-bottom: 15px; padding: 10px; background: #1e1f22; border-radius: 4px;";
            document.querySelector('.sidebar').prepend(listDiv);
        }
        listDiv.innerHTML = "<b>Online:</b><br>" + users.join('<br>');
    }

    // --- LOGIKA MIKROFONU I POŁĄCZENIA ---

    voiceBtn.onclick = async () => {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voiceBtn.style.display = 'none';
            controlsDiv.style.display = 'flex';

            ws.send(JSON.stringify({ type: 'user-joined', userId: clientId }));
            console.log("Dołączono do kanału głosowego");
        } catch (err) {
            alert("Błąd mikrofonu! Sprawdź uprawnienia w Safari.");
        }
    };

    muteBtn.onclick = () => {
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;
        muteBtn.innerText = isMuted ? "Wyłącz Wyciszenie" : "Wycisz Mikrofon";
        muteBtn.style.background = isMuted ? "#23a559" : "#4e5058";
    };

    leaveBtn.onclick = () => {
        // Zatrzymanie mikrofonu
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;

        // Zamknięcie wszystkich połączeń P2P
        Object.keys(peers).forEach(id => removePeer(id));

        // Reset interfejsu
        controlsDiv.style.display = 'none';
        voiceBtn.style.display = 'block';

        // Poinformuj serwer (przeładuj lub wyślij info)
        ws.send(JSON.stringify({ type: 'user-left', userId: clientId }));
    };

    function removePeer(userId) {
        if (peers[userId]) {
            peers[userId].close();
            delete peers[userId];
        }
        const audioEl = document.getElementById(`audio-${userId}`);
        if (audioEl) audioEl.remove();
    }

    // --- FUNKCJE WebRTC (callUser, handleOffer, createPeerConnection) ---
    // (Zostają takie same jak w poprzednim kroku, ale upewnij się, że createPeerConnection używa aktualnego localStream)

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
        if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.onicecandidate = (e) => {
            if (e.candidate) ws.send(JSON.stringify({ candidate: e.candidate, target: targetId, from: clientId }));
        };

        pc.ontrack = (e) => {
            let audio = document.getElementById(`audio-${targetId}`) || document.createElement('audio');
            audio.id = `audio-${targetId}`;
            audio.autoplay = true;
            audio.srcObject = e.streams[0];
            document.body.appendChild(audio);
        };
        return pc;
    }

    function appendMessage(user, text) {
        const div = document.createElement('div');
        div.className = 'msg';
        div.innerHTML = `<b>${user}:</b> ${text}`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    msgInput.onkeypress = (e) => {
        if (e.key === 'Enter' && msgInput.value.trim() !== "") {
            ws.send(JSON.stringify({ type: 'text', user: clientId, text: msgInput.value }));
            appendMessage("Ty", msgInput.value);
            msgInput.value = "";
        }
    };
});