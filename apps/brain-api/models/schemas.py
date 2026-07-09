from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class Vector3(BaseModel):
    x: float
    y: float
    z: float


class VisionHit(BaseModel):
    object_id: str
    label: str
    distance_m: float


class TouchEvent(BaseModel):
    body_part: str
    object_id: str
    impact_force_n: float


class SmellReading(BaseModel):
    object_id: str
    label: str
    voc_ppm: float
    distance_m: float


class JointState(BaseModel):
    name: str
    angle_deg: float
    angular_velocity_deg_s: float


class SensorSnapshot(BaseModel):
    """One tick of real sensor data pushed from the body-sim frontend."""
    session_id: str
    tick: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    position: Vector3
    velocity: Vector3
    tilt_deg: float  # torso tilt from vertical, computed in-sim from physics body orientation

    vision: list[VisionHit] = []
    touch: list[TouchEvent] = []
    smell: list[SmellReading] = []
    joints: list[JointState] = []


class ActionCommand(BaseModel):
    """A single actuator instruction sent back to the body-sim."""
    joint: str
    target_angle_deg: Optional[float] = None
    impulse: Optional[Vector3] = None
    kind: Literal["set_angle", "apply_impulse", "halt"]


class Decision(BaseModel):
    source: Literal["rule_engine", "claude", "cached"]
    goal: str
    reasoning: str
    actions: list[ActionCommand]
    emotional_state: str  # short label, e.g. "cautious", "curious", "alert"


class MemoryEntry(BaseModel):
    id: int
    timestamp: datetime
    kind: Literal["observation", "decision", "summary"]
    content: str
