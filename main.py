import os
import json
import sqlite3
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

# Inicjalizacja bazy danych
DB_PATH = "chat_history.db"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
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
                     TEXT
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

        # 1. Wyślij historię wiadomości z bazy
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT user, text FROM messages ORDER BY id ASC LIMIT 50")
        history = [{"user": row[0], "text": row[1]} for row in c.fetchall()]
        conn.close()
        await websocket.send_text(json.dumps({"type": "history", "messages": history}))

        # 2. Wyślij listę osób online
        users = list(self.active_connections.keys())
        await self.broadcast(json.dumps({"type": "user-list", "users": users}), None)

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def broadcast(self, message: str, sender_id: str = None):
        for cid, connection in self.active_connections.items():
            try:
                await connection.send_text(message)
            except:
                pass

    async def send_to_target(self, target_id: str, message: str):
        if target_id in self.active_connections:
            await self.active_connections[target_id].send_text(message)


manager = ConnectionManager()


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(client_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "text":
                # Zapisz do bazy danych
                conn = sqlite3.connect(DB_PATH)
                c = conn.cursor()
                c.execute("INSERT INTO messages (user, text) VALUES (?, ?)", (message["user"], message["text"]))
                conn.commit()
                conn.close()
                await manager.broadcast(json.dumps(message), client_id)

            elif "target" in message:  # Sygnalizacja WebRTC
                await manager.send_to_target(message["target"], json.dumps(message))

    except WebSocketDisconnect:
        manager.disconnect(client_id)
        users = list(manager.active_connections.keys())
        await manager.broadcast(json.dumps({"type": "user-list", "users": users}))