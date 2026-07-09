# AI Body OS — Phase 1 MVP

Real, working Sense → Understand → Decide → Act → Remember loop in a
simulated 3D body. Not a mock — every piece below actually runs;
scope limits are stated explicitly rather than faked.

## Architecture decision log (read this before assuming anything works)

1. **Original design**: dynamic Rapier rigid bodies + revolute joints,
   physics-simulated ragdoll. **Tested headlessly with real physics**:
   the rig collapsed/tumbled even with motor stiffness cranked to
   2000 — confirmed this is a missing world-frame balance controller,
   not a tuning issue. Verifiable via `verify_physics_headless.mjs`.
2. **Current design**: the humanoid is now a **kinematic stance
   controller** — no gravity acts on it, its pose is fully computed
   from brain-controlled state every frame (same technique Unity/
   Unreal/Isaac Sim character controllers use). It stands by
   construction. It does **not** simulate falling, tripping, or being
   pushed — active dynamic balance is a separate, real control-systems
   task, explicitly out of scope for this phase.
3. **Known Rapier gotcha, found and fixed**: kinematic-vs-fixed
   collider pairs do **not** generate collision events by default
   (`ActiveCollisionTypes.DEFAULT` excludes non-dynamic-vs-non-dynamic
   pairs) — every collider in this project now sets
   `ActiveCollisionTypes.ALL` explicitly. Verified headlessly via
   `verify_kinematic_collision.mjs` (failed before the fix, passes
   after).

## What's real right now

- **Body**: kinematic humanoid — torso, head, 2 arms, 2 legs. Stands
  reliably. Joint angles are exact (source of truth, not derived from
  noisy quaternion math).
- **Sensors**: vision = real raycasts against scene objects. Touch =
  real Rapier collision events (verified headlessly, see above).
  Smell = simulated VOC field from real object distances (smell has
  no physical analog in a 3D sim by definition). Position = joint
  angles set directly by the brain, torso position/velocity from the
  kinematic controller state.
- **Brain**: rule engine every tick (collision/impact safety — the
  balance-recovery rule now targets the real `hip_l`/`hip_r` joint
  names, was previously mismatched and silently a no-op, also fixed).
  Claude API every Nth tick for goal reasoning, grounded in persisted
  memory. **Verified end-to-end live** (this session): WebSocket →
  rule engine → memory write → memory API readback, all real, not
  simulated.
- **Memory**: SQLite (swap to Postgres via `DATABASE_URL`).
- **Command Center**: live 3D view, live sensor readout, live decision
  + reasoning, live memory stream, live connection status/logs.

## What's explicitly NOT built yet

- **Active balance/locomotion control** (walking, recovering from a
  push). Current rig is stance-stable by construction, not by control.
- **Realistic visual model.** Current meshes are primitive boxes/
  capsules/spheres — functional placeholders for the physics/sensor
  layer, not the intended final look. A rigged GLTF humanoid asset
  (separate visual layer driven by the same kinematic joint state) is
  the agreed next step, deferred until the functional loop is solid.
- Local open-source LLM fallback (Phase 2 per the brain-router plan).
- Auth on the API/WebSocket.
- A real end-to-end browser run with a live Anthropic key has **not**
  been done by me (no GPU/browser in my environment) — you're doing
  that verification, and it's how the balance and joint-naming bugs
  above were actually caught. Keep doing that; it's working.

## Run locally

```bash
# Backend — use Python 3.11/3.12, NOT 3.14 (too new, no prebuilt
# wheels for some deps yet as of mid-2026)
cd apps/brain-api
py -3.11 -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env         # put your real ANTHROPIC_API_KEY in
python -m uvicorn main:app --reload

# Frontend (separate terminal)
cd apps/body-sim
npm install
npm run dev
```

Open http://localhost:5173.

## Verification scripts (headless, no browser needed)

- `apps/body-sim/verify_physics_headless.mjs` — proves/disproves the
  dynamic-ragdoll balance question with real Rapier physics in Node.
- `apps/body-sim/verify_kinematic_collision.mjs` — proves kinematic
  colliders generate real collision events once `ActiveCollisionTypes`
  is set correctly.

Run either with `node <script>.mjs` from `apps/body-sim`.

## Run via Docker (local or server)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build
```

Not yet run/verified by me — flagging honestly, same as before.

## Migrating into SURPRAV

Drop this directory in as `/apps/ai-body-sim`. `brain-api` becomes
another backend service (point `DATABASE_URL` at shared Postgres).
`body-sim` builds to static files (`npm run build` → `dist/`). Swap
`ANTHROPIC_API_KEY` to your secrets manager — `config.py` only reads
from environment, no code change needed. Add auth at the WebSocket
handshake in `main.py` before `await ws.accept()` once SURPRAV's
session layer is available.

