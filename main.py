import os
import json
import sqlite3
import httpx
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()
DB_PATH = "chat_history.db"

USERS_DB = {
    "Maciek": os.getenv("PASS_MACIEK"),
    "Samuel": os.getenv("PASS_SAMUEL"),
    "Kris": os.getenv("PASS_KRIS")
}

# Cloudflare TURN — ustaw te zmienne w Render.com → Environment
TURN_TOKEN_ID = os.getenv("TURN_TOKEN_ID")
TURN_API_TOKEN = os.getenv("TURN_API_TOKEN")

voice_users: set[str] = set()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user TEXT,
                  text TEXT,
                  time TEXT,
                  msg_type TEXT DEFAULT 'text')''')
    conn.commit()
    conn.close()


init_db()


async def get_turn_credentials() -> dict:
    """Pobiera krótkotrwałe kredencjale TURN z Cloudflare."""
    if not TURN_TOKEN_ID or not TURN_API_TOKEN:
        # Fallback na publiczny STUN jeśli brak konfiguracji
        return {
            "iceServers": [
                {"urls": "stun:stun.l.google.com:19302"}
            ]
        }
    try:
        url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_TOKEN_ID}/credentials/generate"
        headers = {
            "Authorization": f"Bearer {TURN_API_TOKEN}",
            "Content-Type": "application/json"
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json={"ttl": 86400})
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        print(f"Błąd pobierania TURN credentials: {e}")
        return {
            "iceServers": [
                {"urls": "stun:stun.l.google.com:19302"}
            ]
        }


@app.get("/")
async def get_index():
    return FileResponse(os.path.join("static", "index.html"))


app.mount("/static", StaticFiles(directory="static"), name="static")


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()

        # 1. Historia dla nowego użytkownika
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT user, text, time, msg_type FROM messages ORDER BY id DESC LIMIT 50")
        history = [{"user": r[0], "text": r[1], "time": r[2], "type": r[3]} for r in reversed(c.fetchall())]
        conn.close()
        await websocket.send_text(json.dumps({"type": "history", "messages": history}))

        # 2. Wyślij kredencjale TURN
        ice_config = await get_turn_credentials()
        await websocket.send_text(json.dumps({"type": "ice-config", "config": ice_config}))

        # 3. Dodaj do aktywnych i zaktualizuj listę
        self.active_connections[client_id] = websocket
        await self.update_user_list()

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def update_user_list(self):
        users = list(self.active_connections.keys())
        await self.broadcast(json.dumps({"type": "user-list", "users": users}))

    async def broadcast(self, message: str):
        for connection in list(self.active_connections.values()):
            try:
                await connection.send_text(message)
            except Exception:
                pass

    async def send_to_target(self, target_id: str, message: str):
        if target_id in self.active_connections:
            try:
                await self.active_connections[target_id].send_text(message)
            except Exception:
                pass


manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, pwd: str = Query(None)):
    stored_password = USERS_DB.get(client_id)

    if not stored_password or stored_password != pwd:
        await websocket.accept()
        await websocket.send_text(json.dumps({"type": "error", "msg": "Błędne hasło lub nick!"}))
        await websocket.close()
        return

    await manager.connect(client_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            # --- NOWE: Obsługa pingów ---
            if msg.get("type") == "ping":
                continue

            if msg.get("type") in ["text", "image"]:
                msg["time"] = datetime.now().strftime("%H:%M")
                conn = sqlite3.connect(DB_PATH)
                c = conn.cursor()
                c.execute("INSERT INTO messages (user, text, time, msg_type) VALUES (?, ?, ?, ?)",
                          (msg["user"], msg["text"], msg["time"], msg.get("type", "text")))
                conn.commit()
                conn.close()
                await manager.broadcast(json.dumps(msg))

            elif msg.get("type") == "user-joined-voice":
                voice_users.add(client_id)
                existing = [uid for uid in voice_users if uid != client_id]
                await manager.send_to_target(
                    client_id,
                    json.dumps({"type": "voice-peers", "peers": existing})
                )
                for uid in existing:
                    await manager.send_to_target(
                        uid,
                        json.dumps({"type": "user-joined", "userId": client_id})
                    )

            elif msg.get("type") == "user-left-voice":
                voice_users.discard(client_id)
                await manager.broadcast(json.dumps({"type": "user-left", "userId": client_id}))

            elif "target" in msg:
                await manager.send_to_target(msg["target"], json.dumps(msg))

    except WebSocketDisconnect:
        voice_users.discard(client_id)
        manager.disconnect(client_id)
        await manager.update_user_list()