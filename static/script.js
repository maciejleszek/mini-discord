document.addEventListener('DOMContentLoaded', () => {
    const loginOverlay = document.getElementById('login-overlay');
    const nickInput = document.getElementById('nickname-input');
    const startBtn = document.getElementById('start-btn');
    const chat = document.getElementById('chat');
    const msgInput = document.getElementById('msg-input');
    const imageInput = document.getElementById('image-input');
    const userListDiv = document.getElementById('user-list');
    const voiceBtn = document.getElementById('voice-btn');
    const muteBtn = document.getElementById('mute-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const activeControls = document.getElementById('active-controls');
    const myIdDisplay = document.getElementById('my-id');

    let clientId, ws, localStream, isMuted = false;
    const peers = {};
    const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    startBtn.onclick = () => {
        const val = nickInput.value.trim();
        if (!val) return alert("Podaj nick!");
        clientId = val;
        loginOverlay.style.display = 'none';
        myIdDisplay.innerText = "Zalogowany jako: " + clientId;
        initApp();
    };

    nickInput.onkeypress = (e) => { if (e.key === 'Enter') startBtn.click(); };

    function initApp() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/${encodeURIComponent(clientId)}`);

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);
            console.log("Odebrano sygnał:", data.type);

            switch(data.type) {
                case 'history':
                    chat.innerHTML = "";
                    data.messages.forEach(m => appendMessage(m.user, m.text, m.time, m.type));
                    break;
                case 'user-list':
                    userListDiv.innerHTML = "<b>Online:</b><br>" + data.users.join('<br>');
                    break;
                case 'text':
                case 'image':
                    appendMessage(data.user, data.text, data.time, data.type);
                    break;
                case 'user-joined':
                    if (localStream) callUser(data.userId);
                    break;
                case 'user-left':
                    removePeer(data.userId);
                    break;
                default:
                    handleSignaling(data);
            }
        };

        msgInput.onkeypress = (e) => {
            if (e.key === 'Enter' && msgInput.value.trim()) {
                ws.send(JSON.stringify({
                    type: 'text',
                    user: clientId,
                    text: msgInput.value
                }));
                msgInput.value = "";
            }
        };

        imageInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                ws.send(JSON.stringify({
                    type: 'image',
                    user: clientId,
                    text: ev.target.result
                }));
            };
            reader.readAsDataURL(file);
            e.target.value = "";
        };

        setupVoice();
    }

    function appendMessage(user, content, time, type) {
        const div = document.createElement('div');
        div.className = 'msg';
        const color = (user === clientId) ? '#00aff4' : '#5865f2';

        let body = "";
        if (type === 'image') {
            body = `<img src="${content}" class="chat-img" onclick="window.open(this.src)">`;
        } else {
            body = `<span>${content}</span>`;
        }

        div.innerHTML = `
            <b style="color:${color}">${user} <span class="msg-time">${time || ''}</span></b><br>
            ${body}
        `;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    function setupVoice() {
        voiceBtn.onclick = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                voiceBtn.style.display = 'none';
                activeControls.style.display = 'flex';
                ws.send(JSON.stringify({ type: 'user-joined', userId: clientId }));
            } catch { alert("Brak dostępu do mikrofonu!"); }
        };

        muteBtn.onclick = () => {
            isMuted = !isMuted;
            localStream.getAudioTracks()[0].enabled = !isMuted;
            muteBtn.innerText = isMuted ? "Unmute" : "Mute";
        };

        leaveBtn.onclick = () => {
            if (localStream) {
                localStream.getTracks().forEach(t => t.stop());
                localStream = null;
            }
            Object.keys(peers).forEach(id => removePeer(id));
            activeControls.style.display = 'none';
            voiceBtn.style.display = 'block';
            ws.send(JSON.stringify({ type: 'user-left', userId: clientId }));
        };
    }

    function removePeer(id) {
        if(peers[id]) peers[id].close();
        delete peers[id];
        const a = document.getElementById(`audio-${id}`);
        if(a) a.remove();
    }

    function handleSignaling(data) {
        if (data.offer) handleOffer(data.offer, data.from);
        else if (data.answer && peers[data.from]) {
            peers[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.candidate && peers[data.from]) {
            peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }

    function createPC(id) {
        const pc = new RTCPeerConnection(iceConfig);
        peers[id] = pc;
        if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        pc.onicecandidate = (e) => {
            if (e.candidate) ws.send(JSON.stringify({ candidate: e.candidate, target: id, from: clientId }));
        };
        pc.ontrack = (e) => {
            let a = document.getElementById(`audio-${id}`);
            if(!a) {
                a = document.createElement('audio');
                a.id = `audio-${id}`; a.autoplay = true;
                document.body.appendChild(a);
            }
            a.srcObject = e.streams[0];
        };
        return pc;
    }

    async function callUser(id) {
        const pc = createPC(id);
        const o = await pc.createOffer();
        await pc.setLocalDescription(o);
        ws.send(JSON.stringify({ offer: o, target: id, from: clientId }));
    }

    async function handleOffer(o, id) {
        const pc = createPC(id);
        await pc.setRemoteDescription(new RTCSessionDescription(o));
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        ws.send(JSON.stringify({ answer: a, target: id, from: clientId }));
    }
});