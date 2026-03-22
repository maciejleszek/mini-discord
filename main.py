from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import json

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        # Powiadom innych, że ktoś dołączył
        await self.broadcast(json.dumps({"type": "user-joined", "userId": client_id}), client_id)

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def broadcast(self, message: str, sender_id: str):
        for cid, connection in self.active_connections.items():
            if cid != sender_id:
                await connection.send_text(message)

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

            # Jeśli wiadomość ma adresata (sygnalizacja WebRTC)
            if "target" in message:
                await manager.send_to_target(message["target"], json.dumps(message))
            else:
                # Standardowy czat (broadcast)
                await manager.broadcast(json.dumps(message), client_id)
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast(json.dumps({"type": "user-left", "userId": client_id}), client_id)