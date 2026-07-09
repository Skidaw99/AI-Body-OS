"""
Brain Router.

Sensor Data -> Rule Engine (safety, every tick, can override)
           -> Claude API (deep reasoning, every Nth tick or on escalation)
           -> Cached last decision (in between reasoning ticks)
           -> Action Engine

Phase 2/3 note: a local open-source LLM (Ollama/vLLM) slots in here as
an additional branch for cheap/simple classification tasks (e.g. "is
this object novel", sensor summarization) without touching this file's
safety-first ordering. Not implemented yet — do not fake it with a
stub; it will be added when Phase 2 actually starts.
"""
from models.schemas import SensorSnapshot, Decision
from brain import rule_engine, claude_client, memory
from config import settings

# last known decision per session, used between Claude reasoning ticks
_last_decision: dict[str, Decision] = {}


def process(snapshot: SensorSnapshot) -> Decision:
    # 1. Safety-critical rules always run first and can override everything.
    rule_decision = rule_engine.evaluate(snapshot)
    if rule_decision is not None:
        memory.write(snapshot.session_id, "decision", f"[RULE] {rule_decision.goal}: {rule_decision.reasoning}")
        _last_decision[snapshot.session_id] = rule_decision
        return rule_decision

    # 2. Cost control: only call Claude every N ticks, otherwise reuse
    #    the last reasoning decision (still safe, since rules run every tick).
    should_reason = (
        snapshot.session_id not in _last_decision
        or snapshot.tick % settings.CLAUDE_REASONING_INTERVAL_TICKS == 0
    )

    if not should_reason:
        cached = _last_decision[snapshot.session_id]
        return Decision(
            source="cached",
            goal=cached.goal,
            reasoning=cached.reasoning,
            actions=cached.actions,
            emotional_state=cached.emotional_state,
        )

    # 3. Deep reasoning via Claude, grounded in real recent memory.
    memory.write(snapshot.session_id, "observation", _summarize_observation(snapshot))
    memory_context = memory.recent_as_text(snapshot.session_id, limit=10)
    decision = claude_client.reason(snapshot, memory_context)

    memory.write(snapshot.session_id, "decision", f"[CLAUDE] {decision.goal}: {decision.reasoning}")
    _last_decision[snapshot.session_id] = decision
    return decision


def _summarize_observation(snapshot: SensorSnapshot) -> str:
    parts = [f"tick={snapshot.tick}", f"tilt={snapshot.tilt_deg:.1f}deg"]
    if snapshot.vision:
        parts.append("vision=" + ",".join(f"{h.label}@{h.distance_m:.1f}m" for h in snapshot.vision))
    if snapshot.touch:
        parts.append("touch=" + ",".join(f"{t.body_part}<-{t.object_id}" for t in snapshot.touch))
    if snapshot.smell:
        parts.append("smell=" + ",".join(f"{s.label}:{s.voc_ppm:.1f}ppm" for s in snapshot.smell))
    return " | ".join(parts)
