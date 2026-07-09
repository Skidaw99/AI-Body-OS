# Dynamic Balance Verification

## Scope

This iteration replaces the active browser body’s kinematic stance controller with a dynamic Rapier stance body.

Implemented:

- Dynamic root rigid body under gravity.
- Broad rectangular foot colliders with real friction/contact area.
- COM tracking.
- Support-polygon bounds from the real foot geometry.
- Capture Point / LIPM-style balance control.
- Bounded upright trunk stabilization to preserve the LIPM assumption.
- Command Center telemetry for COM, Capture Point, support polygon, CP margin, and tilt.

Not implemented:

- Walking.
- Stepping capture recovery.
- Hard-push recovery.
- Reinforcement-learning locomotion.
- Full articulated ankle/knee/hip torque stack.
- Browser/GPU visual verification in this environment.

## Headless verification command

```bash
cd apps/body-sim
node verify_dynamic_balance_headless.mjs
```

## Verified output from this iteration

```text
Dynamic stance body mass=173.73kg, push=120Ns at upper torso, dt=0.00833s
Columns: t, COM(x,z), CapturePoint(x,z), support polygon, cp_margin_m, tilt_deg
DISTURBANCE: upper-body impulse 120 Ns at t=1.00s

SUMMARY
min_cp_margin_m=0.089
max_tilt_deg=2.503
final_cp_margin_m=0.321
final_tilt_deg=0.001
RESULT: PASS — dynamic Capture Point balance remained inside support polygon
```

## Additional verification run

```bash
npm run build
```

Result:

```text
✓ built
```

Vite emitted only the existing chunk-size warning.

## Current interpretation

This proves the current dynamic stance controller can remain upright under the configured light upper-body disturbance while keeping the Capture Point inside the support polygon.

It does **not** prove walking, stepping, or recovery from a hard push. Those require either stepping Capture Point control and/or reinforcement learning on top of the classical controller.
