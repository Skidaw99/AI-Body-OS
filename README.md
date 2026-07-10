# AI Body OS — Dynamic Balance Iteration

Real Sense → Understand → Decide → Act → Remember loop in a simulated 3D body, now with a dynamic stance-balance layer. No mock success states: verified behavior is separated from unverified scope.

## Architecture decision log

1. **Initial dynamic ragdoll baseline failed**: the first Rapier revolute-joint ragdoll collapsed/tumbled even with high motor stiffness. That remains preserved as a regression/baseline verifier in `apps/body-sim/verify_physics_headless.mjs` and still reports `RESULT: FALLS OVER`.
2. **Kinematic stance controller has been removed from the active body**: the browser `Humanoid.tsx` is no longer a `kinematicPosition` controller that secretly cannot fall.
3. **Current active design**: one dynamic Rapier stance body with gravity, broad rectangular foot contact surfaces, friction, COM tracking, support-polygon calculation, Capture Point / LIPM balance control, and bounded upright trunk stabilization.
4. **Scope boundary**: this is a dynamic standing controller for light disturbance rejection. It is not walking, stepping, hard-push recovery, RL locomotion, or a full articulated ankle/knee/hip torque stack yet.
5. **Visual layer is separate from physics authority**: what you see is a procedurally generated, genuinely skinned GLB android (`apps/body-sim/public/android.glb`, built by `tools/generate_android_glb.mjs` — self-made, no external assets, no license/provenance risk). It is mounted as a child of the dynamic RigidBody, so position/tilt/falling come straight from real physics; its bones carry the virtual joint names (`neck`, `shoulder_l/r`, `hip_l/r`, `ankle_l/r`) and mirror the same virtual joint registers the brain reads/writes. The explicit colliders remain the only physics authority.

## What is proven right now

- Frontend build: `npm run build` passed after merging the dynamic balance rewrite with the visual layer.
- Headless dynamic balance: `node verify_dynamic_balance_headless.mjs` passed.
  - Disturbance: upper-body impulse of `120 Ns` at `t=1.00s`.
  - Min Capture Point margin inside support polygon: `0.089m`.
  - Max tilt: `2.503°`.
  - Final Capture Point margin: `0.321m`.
  - Final tilt: `0.001°`.
- Kinematic collision verifier still passes as a standalone Rapier gotcha test.
- The old dynamic ragdoll baseline still fails, proving the new pass is not just the old uncontrolled joint rig.
- Visual rig: `verify_visual_rig.mjs` proves the GLB is a true SkinnedMesh whose bones exactly match the virtual joint names and the dynamic body's collider layout (incl. `ankle_l/r` as children of the hips), and that rotating a joint bone genuinely deforms skinned vertices while root-weighted vertices stay put.
- **Vision-sensor bug found & fixed during the visual work**: tagged objects were collected with `scene.children.filter(...)`, which only sees direct children of the scene root — but the props live inside a nested group, so vision read "clear" forever (silent sensor failure, same class as the two earlier bugs). Now `collectTaggedObjects()` traverses the whole graph; `verify_sensors_headless.mjs` reproduces the old bug and proves the fix, and a real headless-Chromium run showed `vision: wall@10.8m` live.
- Brain loop: WebSocket → rule engine → decision → memory write → memory API readback verified end-to-end with a real websocket client against the running backend (rule-engine path; the Claude path needs a real `ANTHROPIC_API_KEY`).
- **Ground-collider bug found & fixed in a real browser run**: the ground's auto-collider was derived from a flat plane mesh and had ~zero thickness, so the dynamic body's small foot colliders sank straight through until the torso collider caught — the android stood buried to its waist. Every headless balance test passed (they model a thick ground), which is exactly why the browser render check exists. Fixed with an explicit thick ground cuboid (top face at y=0); the body now demonstrably stands on its feet in headless Chromium with zero console errors and live balance telemetry (`CP margin 0.320m inside`, `tilt 0.0°`).

## What is real in the current browser body

- **Dynamic physics**: the body is a dynamic Rapier rigid body under gravity. It can fall if the controller is disabled or the disturbance exceeds the controller/support capacity.
- **Feet**: broad rectangular foot colliders, friction, and actual support contact — not narrow capsule legs pretending to have support.
- **Balance telemetry**: COM, Capture Point, support polygon, ZMP target, CP margin, and tilt are exposed in the Command Center.
- **Controller**: Capture Point / LIPM-style control:
  - `xi = com + velocity / omega`
  - `omega = sqrt(g / com_height)`
  - ZMP target is chosen from capture-point error and clamped inside the real support polygon.
  - A bounded trunk stabilizer maintains the upright assumption required by LIPM.
- **Visual layer**: the skinned android + futuristic environment (emissive grid floor, paneled bulkhead, futuristic props) are set dressing on top of the physics. The sensor-tagged props keep the original sensor ids, positions, and collider sizes; the environment decor has no colliders and no sensor tags. The Command Center restyle is theme-only — every displayed value is bound to real store/API data.
- **Honest limitation**: the joints are virtual registers (as introduced with the compound stance body) — setting a joint angle animates the skinned model but does not move the colliders. Articulated physical joints are future mechanical-control work.

## What is not built yet

- Walking.
- Stepping capture recovery.
- Recovering from hard pushes.
- Reinforcement-learning locomotion.
- Full articulated ankle/knee/hip torque control (joint angles currently animate the skin only, see above).
- Local open-source LLM fallback (Phase 2 per the brain-router plan).
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
node verify_visual_rig.mjs
node verify_sensors_headless.mjs
npm run build
```

Expected current truth:

- `verify_dynamic_balance_headless.mjs`: PASS for standing under the configured light disturbance.
- `verify_kinematic_collision.mjs`: PASS for the Rapier collision-event edge case.
- `verify_physics_headless.mjs`: FAILS OVER intentionally, because it is the old uncontrolled ragdoll baseline.
- `verify_visual_rig.mjs`: PASS — GLB loads, rig matches the virtual joints, skinning deforms.
- `verify_sensors_headless.mjs`: PASS — reproduces the old vision-collection bug, proves the fix.
- `npm run build`: passes, with a Vite chunk-size warning only.

Regenerate the android model with `node tools/generate_android_glb.mjs` (writes `public/android.glb`).
