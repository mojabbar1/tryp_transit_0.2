"""The only way the data agent talks to the internet (02 §5 step 2; a Ruff ban on ``requests`` enforces it).

- **robots.txt** (RFC 9309, evaluated by ``tda.http.robots``), when the source sets ``robots_required``:
  cached per origin for 24 h and matched against our product token. Unavailable (4xx) allows everything.
  Unreachable (5xx, 429, network error, the total-time cap, or a redirect off the allowed hosts) disallows
  everything and isn't cached, so the next run checks again.
- **Rate limit:** a request waits ``60 / rate`` seconds after the host's previous request
  (``rate_limit_per_min`` overrides the default), or the host's ``Crawl-delay`` for us if that is longer.
- **Retries:** 429, 5xx, and network errors, up to 4 attempts, with exponential backoff and jitter; a
  ``Retry-After`` is honored (up to 5 minutes; a longer one fails the fetch instead of waiting).
- **Conditional GET:** ``etag`` / ``last_modified`` in, :class:`NotModified` out on 304.
- **Guards:** the body is streamed and aborted past ``max_response_mb``; connect/read and total timeouts; our
  User-Agent on every request; only the source's own host and its ``allowed_hosts`` are ever contacted, and
  redirects never downgrade https to http.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlsplit

import httpx
import structlog
from tenacity import (
    RetryCallState,
    Retrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from tda.config.models import Source
from tda.config.settings import Settings
from tda.http import robots

log = structlog.get_logger(__name__)

MAX_ATTEMPTS = 4
MAX_REDIRECTS = 5
MAX_RETRY_AFTER_S = 300.0
ROBOTS_TTL = timedelta(hours=24)
ROBOTS_MAX_BYTES = 512 * 1024
REDIRECTS = (301, 302, 303, 307, 308)


class FetchError(Exception):
    """A fetch that failed for good (after any retries)."""


class RobotsDisallowed(FetchError):
    """robots.txt disallows the URL for our User-Agent, or robots.txt is unreachable."""


class HostNotAllowed(FetchError):
    """The URL or a redirect points outside the source's host and ``allowed_hosts``, or downgrades to http."""


class ResponseTooLarge(FetchError):
    """The body exceeded ``max_response_mb``."""


class BudgetExceeded(FetchError):
    """The run's request budget is spent."""


class HTTPFailure(FetchError):
    """A non-retryable status, or a retryable one that persisted through every attempt."""

    def __init__(self, url: str, status: int) -> None:
        super().__init__(f"HTTP {status} from {redact(url)}")
        self.status = status


@dataclass(frozen=True)
class NotModified:
    """304: the source hasn't changed since ``etag`` / ``last_modified``."""

    url: str
    etag: str | None
    last_modified: str | None


@dataclass(frozen=True)
class FetchResponse:
    """A 2xx response with its whole (capped) body."""

    url: str
    status: int
    body: bytes
    sha256: str
    content_type: str | None
    etag: str | None
    last_modified: str | None


@dataclass
class RequestBudget:
    """At most ``limit`` requests for one run; spent before each attempt (robots.txt is free)."""

    limit: int
    used: int = 0

    def spend(self) -> None:
        """Take one request, or raise :class:`BudgetExceeded`."""
        if self.used >= self.limit:
            raise BudgetExceeded(f"request budget of {self.limit} is spent")
        self.used += 1


@dataclass
class _Robots:
    rules: robots.RobotsRules | None
    allow_all: bool
    fetched_at: datetime


@dataclass
class _HostPace:
    last_at: float | None = None
    crawl_delay: float = 0.0


class _Retryable(Exception):
    def __init__(self, status: int, retry_after: float | None) -> None:
        super().__init__(f"retryable HTTP {status}")
        self.status = status
        self.retry_after = retry_after


@dataclass
class _Attempt:
    url: str
    status: int
    headers: httpx.Headers
    body: bytes = b""
    sha256: str = ""


def redact(url: str) -> str:
    """``scheme://host/path`` only: query strings may carry keys, so they never reach a log."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.rsplit('@', 1)[-1]}{parts.path}"


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.rsplit('@', 1)[-1].lower()}"


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _utcnow() -> datetime:
    return datetime.now(UTC)


class PoliteClient:
    """A shared client for every connector; one instance per worker process."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._settings = settings
        self._sleep = sleep
        self._monotonic = monotonic
        self._now = now
        self._max_bytes = settings.max_response_mb * 1024 * 1024
        self._robots: dict[str, _Robots] = {}
        self._pace: dict[str, _HostPace] = {}
        self._lock = threading.Lock()
        self._client = httpx.Client(
            transport=transport,
            timeout=httpx.Timeout(settings.http_timeout_s),
            follow_redirects=False,
            headers={"User-Agent": settings.user_agent},
        )

    def close(self) -> None:
        """Close the connection pool."""
        self._client.close()

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def fetch(
        self,
        source: Source,
        url: str | None = None,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
        budget: RequestBudget | None = None,
    ) -> FetchResponse | NotModified:
        """GET ``url`` (default: the source's URL) politely; see the module docstring for every rule."""
        url = url or (str(source.url) if source.url else None)
        if url is None:
            raise ValueError(f"source {source.id} has no url to fetch")
        self._check_host(source, url, previous=None)
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        for _ in range(MAX_REDIRECTS + 1):
            if source.robots_required and not self.robots_allows(source, url):
                raise RobotsDisallowed(f"robots.txt disallows {redact(url)} for our User-Agent")
            attempt = self._with_retries(source, url, headers, budget)
            if attempt.status in REDIRECTS and "location" in attempt.headers:
                target = urljoin(url, attempt.headers["location"])
                self._check_host(source, target, previous=url)
                url = target
                continue
            if attempt.status == 304:
                return NotModified(
                    url, attempt.headers.get("etag", etag), attempt.headers.get("last-modified")
                )
            if 200 <= attempt.status < 300:
                return FetchResponse(
                    url=url,
                    status=attempt.status,
                    body=attempt.body,
                    sha256=attempt.sha256,
                    content_type=attempt.headers.get("content-type"),
                    etag=attempt.headers.get("etag"),
                    last_modified=attempt.headers.get("last-modified"),
                )
            raise HTTPFailure(url, attempt.status)
        raise FetchError(f"more than {MAX_REDIRECTS} redirects from {redact(url)}")

    def robots_allows(self, source: Source, url: str) -> bool:
        """Whether robots.txt lets our User-Agent fetch ``url`` (fetched and cached as needed)."""
        rules = self._robots_for(source, _origin(url))
        if rules.rules is None:
            return rules.allow_all
        return rules.rules.allows(url)

    def _check_host(self, source: Source, url: str, *, previous: str | None) -> None:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https"):
            raise HostNotAllowed(f"refusing a {parts.scheme or 'relative'} URL")
        if previous is not None and urlsplit(previous).scheme == "https" and parts.scheme == "http":
            raise HostNotAllowed(f"refusing a redirect from https to http ({redact(url)})")
        allowed = {h.lower() for h in source.allowed_hosts}
        if source.url is not None:
            allowed.add(_host(str(source.url)))
        if _host(url) not in allowed:
            raise HostNotAllowed(f"{_host(url)} is not the source's host or in its allowed_hosts")

    def _wait_turn(self, source: Source, url: str) -> None:
        rate = source.rate_limit_per_min or self._settings.default_rate_limit_per_min
        with self._lock:  # reserve the slot under the lock (scheduler jobs run in threads), sleep outside it
            pace = self._pace.setdefault(_host(url), _HostPace())
            now = self._monotonic()
            gap = max(60.0 / rate, pace.crawl_delay)
            slot = now if pace.last_at is None else max(now, pace.last_at + gap)
            pace.last_at = slot
        if slot > now:
            self._sleep(slot - now)

    def _with_retries(
        self, source: Source, url: str, headers: dict[str, str], budget: RequestBudget | None
    ) -> _Attempt:
        retrying = Retrying(
            stop=stop_after_attempt(MAX_ATTEMPTS),
            wait=_wait,
            retry=retry_if_exception_type((_Retryable, httpx.TransportError)),
            sleep=self._sleep,
            reraise=True,
        )
        try:
            return retrying(self._attempt, source, url, headers, budget)
        except _Retryable as error:
            raise HTTPFailure(url, error.status) from None
        except httpx.TransportError as error:
            raise FetchError(f"{type(error).__name__} fetching {redact(url)}") from None

    def _attempt(
        self, source: Source, url: str, headers: dict[str, str], budget: RequestBudget | None
    ) -> _Attempt:
        if budget is not None:
            budget.spend()
        self._wait_turn(source, url)
        started = self._monotonic()
        with self._client.stream("GET", url, headers=headers) as response:
            log.info("http.fetch", source=source.id, url=redact(url), status=response.status_code)
            if response.status_code == 429 or response.status_code >= 500:
                raise _Retryable(response.status_code, self._retry_after(response))
            attempt = _Attempt(url, response.status_code, response.headers)
            if not 200 <= response.status_code < 300:
                return attempt
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > self._max_bytes:
                raise ResponseTooLarge(f"{redact(url)} declares {declared} bytes (cap {self._max_bytes})")
            digest, chunks, size = hashlib.sha256(), [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > self._max_bytes:
                    raise ResponseTooLarge(f"{redact(url)} exceeded {self._max_bytes} bytes")
                if self._monotonic() - started > self._settings.http_total_timeout_s:
                    raise FetchError(f"{redact(url)} took longer than {self._settings.http_total_timeout_s}s")
                digest.update(chunk)
                chunks.append(chunk)
            attempt.body = b"".join(chunks)
            attempt.sha256 = digest.hexdigest()
            return attempt

    def _retry_after(self, response: httpx.Response) -> float | None:
        value = response.headers.get("retry-after")
        if not value:
            return None
        if value.strip().isdigit():
            seconds = float(value.strip())
        else:
            try:
                seconds = (parsedate_to_datetime(value) - self._now()).total_seconds()
            except (TypeError, ValueError):
                return None
        seconds = max(seconds, 0.0)
        if seconds > MAX_RETRY_AFTER_S:
            raise FetchError(f"server asked us to wait {seconds:.0f}s (Retry-After); not waiting that long")
        return seconds

    def _robots_for(self, source: Source, origin: str) -> _Robots:
        cached = self._robots.get(origin)
        if cached is not None and self._now() - cached.fetched_at < ROBOTS_TTL:
            return cached
        rules = self._fetch_robots(source, origin)
        if rules is None:
            return _Robots(None, allow_all=False, fetched_at=self._now())
        self._robots[origin] = rules
        delay = rules.rules.crawl_delay if rules.rules else None
        if delay:
            self._pace.setdefault(_host(origin), _HostPace()).crawl_delay = float(delay)
        return rules

    def _fetch_robots(self, source: Source, origin: str) -> _Robots | None:
        """RFC 9309 §2.3.1: None means unreachable (disallow, don't cache).

        The total-time cap covers the whole retrieval, redirects included; running out counts as unreachable.
        """
        url = f"{origin}/robots.txt"
        started = self._monotonic()
        for _ in range(MAX_REDIRECTS + 1):
            self._wait_turn(source, url)
            if self._monotonic() - started > self._settings.http_total_timeout_s:
                log.warning("robots.unreachable", origin=origin, error="total timeout")
                return None
            try:
                with self._client.stream("GET", url) as response:
                    status = response.status_code
                    if status in REDIRECTS and "location" in response.headers:
                        target = urljoin(url, response.headers["location"])
                        try:
                            self._check_host(source, target, previous=url)
                        except HostNotAllowed:
                            log.warning("robots.redirect_blocked", origin=origin, target=redact(target))
                            return None
                        url = target
                        continue
                    if status == 429 or status >= 500:
                        log.warning("robots.unreachable", origin=origin, status=status)
                        return None
                    if 400 <= status < 500:
                        return _Robots(None, allow_all=True, fetched_at=self._now())
                    if not 200 <= status < 300:
                        return None
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        if self._monotonic() - started > self._settings.http_total_timeout_s:
                            log.warning("robots.unreachable", origin=origin, error="total timeout")
                            return None
                        body += chunk
                        if len(body) >= ROBOTS_MAX_BYTES:
                            del body[ROBOTS_MAX_BYTES:]
                            break
            except httpx.TransportError as error:
                log.warning("robots.unreachable", origin=origin, error=type(error).__name__)
                return None
            text = bytes(body).decode("utf-8", errors="replace")
            return _Robots(
                robots.parse(text, self._settings.user_agent), allow_all=False, fetched_at=self._now()
            )
        # RFC 9309 §2.3.1.2: after five redirects the file MAY be treated as unavailable.
        return _Robots(None, allow_all=True, fetched_at=self._now())


def _wait(state: RetryCallState) -> float:
    error = state.outcome.exception() if state.outcome else None
    if isinstance(error, _Retryable) and error.retry_after is not None:
        return error.retry_after
    return wait_exponential_jitter(initial=1, max=30)(state)
