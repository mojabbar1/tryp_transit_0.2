"""Runtime settings, read from ``TDA_*`` environment variables (pydantic-settings)."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from tda import __version__

# data_agent/ — the package's parent directory, never the current working directory.
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
# D-18: the crawler identity carries a contact. The maintainer chose the repository URL.
CONTACT = "https://github.com/mojabbar1/tryp_transit_0.2"
DEFAULT_USER_AGENT = f"TrypTransitDataAgent/{__version__} (+{CONTACT})"


class Settings(BaseSettings):
    """Settings for every entry point. Database URLs are plain ``postgresql://``; code adds the driver."""

    model_config = SettingsConfigDict(env_prefix="TDA_", extra="ignore")

    database_url: str | None = None
    """Writer role (``tda_writer``): connectors, the worker, and the review runtime."""
    admin_database_url: str | None = None
    """A superuser or ``tda_owner``: ``db bootstrap`` and migrations (which run as ``tda_owner``)."""
    reader_database_url: str | None = None
    """Reader role (``tda_reader``): the read API."""

    project_root: Path = PACKAGE_ROOT
    raw_store_dir: Path | None = None
    inbox_dir: Path | None = None

    user_agent: str = DEFAULT_USER_AGENT
    region: str = "charleston"
    http_timeout_s: float = Field(20, gt=0)
    """Connect and per-read timeout for one request."""
    http_total_timeout_s: float = Field(300, gt=0)
    """Upper bound on one response's whole download, however slowly the server drips bytes."""
    default_rate_limit_per_min: int = Field(30, gt=0)
    max_response_mb: int = Field(200, gt=0)
    api_port: int = Field(8081, gt=0, lt=65536)

    @field_validator("user_agent")
    @classmethod
    def _user_agent_has_contact(cls, value: str) -> str:
        if "@" not in value and not re.search(r"https?://\S+", value):
            raise ValueError("user_agent must include a contact (an email address or a URL), per D-18")
        return value

    @field_validator("database_url", "admin_database_url", "reader_database_url")
    @classmethod
    def _plain_postgres_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("postgresql://", "postgres://")):
            raise ValueError("use a plain postgresql:// URL; the driver is added in code")
        return value

    @model_validator(mode="after")
    def _resolve_paths(self) -> Settings:
        if not self.project_root.is_absolute():
            raise ValueError(
                "project_root must be an absolute path (it is never derived from the working directory)"
            )
        root = self.project_root.resolve()
        self.project_root = root
        self.raw_store_dir = _under(root, self.raw_store_dir, "raw")
        self.inbox_dir = _under(root, self.inbox_dir, "inbox")
        return self

    @property
    def config_dir(self) -> Path:
        """Directory holding ``sources.yaml`` and ``regions/``."""
        return self.project_root / "tda" / "config"


def _under(root: Path, value: Path | None, default: str) -> Path:
    path = value if value is not None else Path(default)
    return path if path.is_absolute() else (root / path).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings, parsed once."""
    return Settings()
