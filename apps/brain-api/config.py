"""
Config loader. All secrets come from environment variables.
Never hardcode API keys. Local dev: .env file (see .env.example).
Production: inject via secrets manager (AWS Secrets Manager, Vault, etc.)
and set as real environment variables in the deploy pipeline.
"""
import os
from dotenv import load_dotenv

load_dotenv()  # no-op in production if no .env file exists; env vars win


def _require(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Set it in your .env (local) or secrets manager (production)."
        )
    return val


class Settings:
    # --- Claude API (required, Phase 1 brain) ---
    ANTHROPIC_API_KEY: str = _require("ANTHROPIC_API_KEY")
    CLAUDE_MODEL: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-5")
    CLAUDE_MAX_TOKENS: int = int(os.getenv("CLAUDE_MAX_TOKENS", "1024"))

    # --- Persistence ---
    # Local/dev default: sqlite file. Production: point at Postgres.
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./ai_body_os.db")

    # --- Server ---
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    ALLOWED_ORIGINS: list[str] = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

    # --- Safety / rule engine thresholds ---
    COLLISION_STOP_DISTANCE_M: float = float(os.getenv("COLLISION_STOP_DISTANCE_M", "0.4"))
    BALANCE_TILT_LIMIT_DEG: float = float(os.getenv("BALANCE_TILT_LIMIT_DEG", "35"))

    # --- Brain routing ---
    # How many decision cycles between Claude calls (cost control).
    # Rule engine + cached decision runs every tick; Claude reasoning
    # runs every Nth tick, or immediately on a rule-engine escalation.
    CLAUDE_REASONING_INTERVAL_TICKS: int = int(os.getenv("CLAUDE_REASONING_INTERVAL_TICKS", "10"))


settings = Settings()
