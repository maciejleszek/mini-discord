import os, json, sqlite3
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()
DB_PATH = "chat_history.db"

# KONFIGURACJA DOSTĘPU - Zmień hasła na własne!
USERS_DB = {
    "Maciek": "komuch1",
    "Samuel": "komuch2",
    "Kris": "komuch3"
}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Tabela obsługuje teraz typ wiadomości (text/image)
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (
                     id
                     INTEGER
                     PRIMARY
                     KEY
                     AUTOINCREMENT,
                     user
                     TEXT,
                     text
                     TEXT,
                     time
                     TEXT,
                     msg_type
                     TEXT
                     DEFAULT
                     'text'
                 )''')
    conn.commit()
    conn.close()


init_db()


@app.get("/")
async def get_index():
    return FileResponse(os.path.join("static", "index.html"))


app.mount("/static", StaticFiles(directory="static"), name="static")


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket

        # Pobieranie historii
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT user, text, time, msg_type FROM messages ORDER BY id ASC LIMIT 50")
        history = [{"user": r[0], "text": r[1], "time": r[2], "type": r[3]} for r in c.fetchall()]
        conn.close()

        await websocket.send_text(json.dumps({"type": "history", "messages": history}))
        await self.update_user_list()

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def update_user_list(self):
        users = list(self.active_connections.keys())
        await self.broadcast(json.dumps({"type": "user-list", "users": users}))

    async def broadcast(self, message: str):
        for connection in self.active_connections.values():
            try:
                await connection.send_text(message)
            except:
                pass

    async def send_to_target(self, target_id: str, message: str):
        if target_id in self.active_connections:
            try:
                await self.active_connections[target_id].send_text(message)
            except:
                pass


manager = ConnectionManager()


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, pwd: str = Query(None)):
    if client_id not in USERS_DB or USERS_DB[client_id] != pwd:
        await websocket.accept()
        await websocket.send_text(json.dumps({"type": "error", "msg": "Błędne hasło lub nick!"}))
        await websocket.close()
        return

    await manager.connect(client_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") in ["text", "image"]:
                msg["time"] = datetime.now().strftime("%H:%M")
                conn = sqlite3.connect(DB_PATH)
                c = conn.cursor()
                c.execute("INSERT INTO messages (user, text, time, msg_type) VALUES (?, ?, ?, ?)",
                          (msg["user"], msg["text"], msg["time"], msg.get("type", "text")))
                conn.commit()
                conn.close()
                await manager.broadcast(json.dumps(msg))
            elif "target" in msg:
                await manager.send_to_target(msg["target"], json.dumps(msg))
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.update_user_list()