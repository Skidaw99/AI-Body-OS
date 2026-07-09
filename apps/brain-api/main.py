import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from config import settings
from models.schemas import SensorSnapshot, MemoryEntry
from brain import memory, router as brain_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ai-body-os.brain-api")

app = FastAPI(title="AI Body OS - Brain API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    memory.init_db()
    log.info("Brain API started. Claude model=%s, DB=%s", settings.CLAUDE_MODEL, settings.DATABASE_URL)


@app.get("/health")
def health():
    return {"status": "ok", "model": settings.CLAUDE_MODEL}


@app.get("/memory/{session_id}", response_model=list[MemoryEntry])
def get_memory(session_id: str, limit: int = 50):
    rows = memory.recent(session_id, limit)
    return [
        MemoryEntry(id=r.id, timestamp=r.timestamp, kind=r.kind, content=r.content)
        for r in rows
    ]


@app.websocket("/ws/brain")
async def brain_loop(ws: WebSocket):
    """
    Real-time Sense -> Understand -> Decide -> Act loop.
    Frontend (body-sim) sends one SensorSnapshot per physics tick;
    backend returns one Decision (with actions) per snapshot.
    """
    await ws.accept()
    log.info("body-sim connected")
    try:
        while True:
            raw = await ws.receive_json()
            try:
                snapshot = SensorSnapshot(**raw)
            except ValidationError as e:
                await ws.send_json({"error": "invalid_snapshot", "detail": e.errors()})
                continue

            decision = brain_router.process(snapshot)
            await ws.send_json(decision.model_dump(mode="json"))
    except WebSocketDisconnect:
        log.info("body-sim disconnected")
