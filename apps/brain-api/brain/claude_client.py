"""
Real Claude API integration for high-level reasoning/planning.
Requires ANTHROPIC_API_KEY in the environment (see config.py).
This is Phase 1 of the brain router: Claude handles goals, decisions,
explanations, and memory summarization. Local LLM fallback (Phase 2)
and hybrid cost router (Phase 3) plug in alongside this, not instead
of it — see brain/router.py.
"""
import json
from anthropic import Anthropic

from config import settings
from models.schemas import SensorSnapshot, Decision, ActionCommand

_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

SYSTEM_PROMPT = """You are the reasoning core of an embodied AI agent \
operating in a physics-simulated 3D body. You receive real sensor data \
(vision raycast hits, touch/collision events, simulated smell/VOC \
readings, joint states, balance) and recent memory. You must decide the \
next high-level action.

Hard constraints:
- Safety-critical avoidance is already handled by a separate rule engine \
that runs before you and can override you. You do not need to re-litigate \
immediate collision/balance/impact safety — focus on goals, exploration, \
and task reasoning.
- Respond with ONLY a JSON object, no prose, no markdown fences, matching \
exactly this schema:
{
  "goal": "short_snake_case_goal",
  "reasoning": "1-3 sentences explaining the decision",
  "actions": [{"joint": "string", "kind": "set_angle|apply_impulse|halt", \
"target_angle_deg": number|null}],
  "emotional_state": "one short word, e.g. curious, cautious, focused, calm"
}
"""


def _snapshot_to_prompt(snapshot: SensorSnapshot, memory_context: str) -> str:
    return (
        f"Recent memory:\n{memory_context}\n\n"
        f"Current sensor snapshot (tick {snapshot.tick}):\n"
        f"Position: {snapshot.position.model_dump()}\n"
        f"Velocity: {snapshot.velocity.model_dump()}\n"
        f"Torso tilt: {snapshot.tilt_deg:.1f} deg\n"
        f"Vision hits: {[h.model_dump() for h in snapshot.vision]}\n"
        f"Touch events: {[t.model_dump() for t in snapshot.touch]}\n"
        f"Smell readings: {[s.model_dump() for s in snapshot.smell]}\n"
        f"Joint states: {[j.model_dump() for j in snapshot.joints]}\n\n"
        f"Decide the next action."
    )


def reason(snapshot: SensorSnapshot, memory_context: str) -> Decision:
    message = _client.messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _snapshot_to_prompt(snapshot, memory_context)}],
    )

    raw_text = "".join(block.text for block in message.content if block.type == "text").strip()
    raw_text = raw_text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Claude returned non-JSON output, cannot parse: {raw_text[:300]}") from e

    actions = [ActionCommand(**a) for a in parsed.get("actions", [])]

    return Decision(
        source="claude",
        goal=parsed["goal"],
        reasoning=parsed["reasoning"],
        actions=actions,
        emotional_state=parsed.get("emotional_state", "neutral"),
    )
