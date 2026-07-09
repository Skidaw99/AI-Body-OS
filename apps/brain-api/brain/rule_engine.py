"""
Safety-critical rule engine. Runs on EVERY tick, before Claude is ever
consulted. If a hard rule fires, it overrides Claude/LLM output entirely.
This is intentional: reasoning models are not allowed to be the last
line of defense for physical safety in this architecture.
"""
from models.schemas import SensorSnapshot, Decision, ActionCommand
from config import settings


def evaluate(snapshot: SensorSnapshot) -> Decision | None:
    """
    Returns a Decision if a safety rule fires (which takes priority
    over the brain router), otherwise None (fall through to Claude/cache).
    """

    # --- Rule 1: imminent collision ---
    close_hits = [h for h in snapshot.vision if h.distance_m <= settings.COLLISION_STOP_DISTANCE_M]
    if close_hits:
        nearest = min(close_hits, key=lambda h: h.distance_m)
        return Decision(
            source="rule_engine",
            goal="avoid_collision",
            reasoning=(
                f"Object '{nearest.label}' detected at {nearest.distance_m:.2f}m, "
                f"below safety threshold of {settings.COLLISION_STOP_DISTANCE_M}m. "
                f"Halting forward motion."
            ),
            actions=[ActionCommand(joint="root", kind="halt")],
            emotional_state="alert",
        )

    # --- Rule 2: balance / fall risk ---
    if abs(snapshot.tilt_deg) >= settings.BALANCE_TILT_LIMIT_DEG:
        return Decision(
            source="rule_engine",
            goal="recover_balance",
            reasoning=(
                f"Torso tilt {snapshot.tilt_deg:.1f}° exceeds safe limit of "
                f"{settings.BALANCE_TILT_LIMIT_DEG}°. Re-asserting hip stance motors. "
                f"Note: this is passive stiffness, not active balance recovery — if the "
                f"torso has already toppled, this will not stand it back up."
            ),
            actions=[
                ActionCommand(joint="hip_l", kind="set_angle", target_angle_deg=0.0),
                ActionCommand(joint="hip_r", kind="set_angle", target_angle_deg=0.0),
            ],
            emotional_state="alert",
        )

    # --- Rule 3: hard impact ---
    hard_hits = [t for t in snapshot.touch if t.impact_force_n > 200.0]
    if hard_hits:
        part = hard_hits[0].body_part
        return Decision(
            source="rule_engine",
            goal="protect_from_impact",
            reasoning=f"Hard impact ({hard_hits[0].impact_force_n:.0f}N) on {part}. Halting all motion.",
            actions=[ActionCommand(joint="root", kind="halt")],
            emotional_state="alert",
        )

    return None
