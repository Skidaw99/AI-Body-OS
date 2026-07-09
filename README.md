# AI Body OS — Dynamic Balance Iteration

Real Sense → Understand → Decide → Act → Remember loop in a simulated 3D body, now with a dynamic stance-balance layer. No mock success states: verified behavior is separated from unverified scope.

## Architecture decision log

1. **Initial dynamic ragdoll baseline failed**: the first Rapier revolute-joint ragdoll collapsed/tumbled even with high motor stiffness. That remains preserved as a regression/baseline verifier in `apps/body-sim/verify_physics_headless.mjs` and still reports `RESULT: FALLS OVER`.
2. **Kinematic stance controller has been removed from the active body**: the browser `Humanoid.tsx` is no longer a `kinematicPosition` controller that secretly cannot fall.
3. **Current active design**: one dynamic Rapier stance body with gravity, broad rectangular foot contact surfaces, friction, COM tracking, support-polygon calculation, Capture Point / LIPM balance control, and bounded upright trunk stabilization.
4. **Scope boundary**: this is a dynamic standing controller for light disturbance rejection. It is not walking, stepping, hard-push recovery, RL locomotion, or a full articulated ankle/knee/hip torque stack yet.

## What is proven right now

- Frontend build: `npm run build` passed after the dynamic balance rewrite.
- Headless dynamic balance: `node verify_dynamic_balance_headless.mjs` passed.
  - Disturbance: upper-body impulse of `120 Ns` at `t=1.00s`.
  - Min Capture Point margin inside support polygon: `0.089m`.
  - Max tilt: `2.503°`.
  - Final Capture Point margin: `0.321m`.
  - Final tilt: `0.001°`.
- Kinematic collision verifier still passes as a standalone Rapier gotcha test.
- The old dynamic ragdoll baseline still fails, proving the new pass is not just the old uncontrolled joint rig.

## What is real in the current browser body

- **Dynamic physics**: the body is a dynamic Rapier rigid body under gravity. It can fall if the controller is disabled or the disturbance exceeds the controller/support capacity.
- **Feet**: broad rectangular foot colliders, friction, and actual support contact — not narrow capsule legs pretending to have support.
- **Balance telemetry**: COM, Capture Point, support polygon, ZMP target, CP margin, and tilt are exposed in the Command Center.
- **Controller**: Capture Point / LIPM-style control:
  - `xi = com + velocity / omega`
  - `omega = sqrt(g / com_height)`
  - ZMP target is chosen from capture-point error and clamped inside the real support polygon.
  - A bounded trunk stabilizer maintains the upright assumption required by LIPM.

## What is not built yet

- Walking.
- Stepping capture recovery.
- Recovering from hard pushes.
- Reinforcement-learning locomotion.
- Full articulated ankle/knee/hip torque control.
- Realistic rigged GLTF humanoid/robot visual layer.
- Auth on the API/WebSocket.
- Docker Compose verification.

## Run locally

```bash
cd apps/brain-api
py -3.11 -m venv venv
venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn main:app --reload

cd ../body-sim
npm install
npm run dev
```

Open http://localhost:5173.

## Verification

```bash
cd apps/body-sim
npm ci
node verify_dynamic_balance_headless.mjs
node verify_kinematic_collision.mjs
node verify_physics_headless.mjs
npm run build
```

Expected current truth:

- `verify_dynamic_balance_headless.mjs`: PASS for standing under the configured light disturbance.
- `verify_kinematic_collision.mjs`: PASS for the Rapier collision-event edge case.
- `verify_physics_headless.mjs`: FAILS OVER intentionally, because it is the old uncontrolled ragdoll baseline.
- `npm run build`: passes, with a Vite chunk-size warning only.
