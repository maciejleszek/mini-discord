import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()


# 1. Obsługa strony głównej
@app.get("/")
async def get_index():
    # Upewnij się, że plik index.html jest w folderze 'static'
    return FileResponse(os.path.join("static", "index.html"))


# 2. Pliki statyczne (js, css)
app.mount("/static", StaticFiles(directory="static"), name="static")


# 3. Zarządzanie połączeniami
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        # Wysyłamy nowemu użytkownikowi listę wszystkich obecnych
        users = list(self.active_connections.keys())
        await websocket.send_text(json.dumps({"type": "user-list", "users": users}))
        # Informujemy innych o nowym graczu
        await self.broadcast(json.dumps({"type": "user-joined", "userId": client_id}), client_id)

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def broadcast(self, message: str, sender_id: str):
        for cid, connection in self.active_connections.items():
            if cid != sender_id:
                try:
                    await connection.send_text(message)
                except:
                    pass  # Ignoruj martwe połączenia

    async def send_to_target(self, target_id: str, message: str):
        if target_id in self.active_connections:
            try:
                await self.active_connections[target_id].send_text(message)
            except:
                pass


manager = ConnectionManager()


# 4. ENDPOINT WEBSOCKET (To tutaj Safari zgłasza błąd)
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(client_id, websocket)
    try:
        while True:
            # Czekamy na dane od klienta
            data = await websocket.receive_text()
            message = json.loads(data)

            # Logika przesyłania dalej (Signaling dla WebRTC)
            if "target" in message:
                await manager.send_to_target(message["target"], json.dumps(message))
            else:
                await manager.broadcast(json.dumps(message), client_id)

    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast(json.dumps({"type": "user-left", "userId": client_id}), client_id)
    except Exception as e:
        print(f"Błąd WebSocket: {e}")
        manager.disconnect(client_id)