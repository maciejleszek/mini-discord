const clientId = "User_" + Math.random().toString(36).substr(2, 4);
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${clientId}`);

const peers = {}; // Przechowuje połączenia RTCPeerConnection
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let localStream;

// --- OBSŁUGA WEBSOCKET ---
ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'text') {
        appendMessage(data.user, data.text);
    } else if (data.type === 'user-joined') {
        console.log("Nowy użytkownik:", data.userId);
        if (localStream) callUser(data.userId);
    } else if (data.offer) {
        handleOffer(data.offer, data.from);
    } else if (data.answer) {
        peers[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
        peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
    }
};

// --- FUNKCJE GŁOSOWE ---
async function startVoice() {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    document.getElementById('voice-btn').innerText = "Głos: ON 🔊";
    document.getElementById('voice-btn').style.background = "#23a559";
}

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
    const pc = new RTCPeerConnection(config);
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
        document.body.appendChild(audio); // Ukryty element audio
    };

    return pc;
}

// Obsługa przycisku i czatu (uproszczona)
document.getElementById('voice-btn').onclick = startVoice;
function appendMessage(user, text) {
    const div = document.createElement('div');
    div.innerHTML = `<b>${user}:</b> ${text}`;
    document.getElementById('chat').appendChild(div);
}