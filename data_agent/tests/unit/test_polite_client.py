"""Polite client (P2 T5): robots, pacing, retries, conditional GET, and the size, host, and budget guards.

Every request hits a respx route; nothing reaches the network. Time is a fake clock, so no test sleeps.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from typing import Any

import httpx
import pytest
import respx

from tda.config.settings import DEFAULT_USER_AGENT, Settings
from tda.http.polite_client import (
    BudgetExceeded,
    FetchError,
    FetchResponse,
    HostNotAllowed,
    HTTPFailure,
    NotModified,
    PoliteClient,
    RequestBudget,
    ResponseTooLarge,
    RobotsDisallowed,
    redact,
)
from tests.support.factories import make_source

PAGE = "https://h.test/page"
ROBOTS = "https://h.test/robots.txt"


@dataclass
class Clock:
    t: float = 0.0
    start: datetime = datetime(2026, 9, 27, 12, tzinfo=UTC)
    sleeps: list[float] = field(default_factory=list)

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(round(seconds, 3))
        self.t += seconds

    def now(self) -> datetime:
        return self.start + timedelta(seconds=self.t)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def router() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False) as mocked:
        yield mocked


def _client(clock: Clock, **settings: Any) -> PoliteClient:
    return PoliteClient(Settings(**settings), sleep=clock.sleep, monotonic=clock.monotonic, now=clock.now)


def _html(**overrides: Any):
    return make_source(kind="html", robots_required=True, url=PAGE, **overrides)


def _rest(**overrides: Any):
    return make_source(url=PAGE, **overrides)


# robots.txt


def test_robots_disallow_blocks_before_the_page_is_requested(clock: Clock, router: respx.MockRouter) -> None:
    router.get(ROBOTS).respond(200, text="User-agent: *\nDisallow: /page\n")
    page = router.get(PAGE).respond(200, text="hi")
    with pytest.raises(RobotsDisallowed):
        _client(clock).fetch(_html())
    assert not page.called


def test_robots_group_for_our_user_agent_wins(clock: Clock, router: respx.MockRouter) -> None:
    router.get(ROBOTS).respond(
        200, text="User-agent: *\nAllow: /\n\nUser-agent: TrypTransitDataAgent\nDisallow: /\n"
    )
    with pytest.raises(RobotsDisallowed):
        _client(clock).fetch(_html())


def test_robots_unavailable_4xx_allows(clock: Clock, router: respx.MockRouter) -> None:
    router.get(ROBOTS).respond(404)
    router.get(PAGE).respond(200, text="hi")
    result = _client(clock).fetch(_html())
    assert isinstance(result, FetchResponse) and result.body == b"hi"


@pytest.mark.parametrize("failure", [503, 429, httpx.ConnectError("down")], ids=["5xx", "429", "network"])
def test_robots_unreachable_disallows_and_is_checked_again(
    clock: Clock, router: respx.MockRouter, failure: object
) -> None:
    robots = router.get(ROBOTS)
    robots.side_effect = failure if isinstance(failure, Exception) else httpx.Response(failure)  # type: ignore[arg-type]
    page = router.get(PAGE).respond(200)
    client = _client(clock)
    for _ in range(2):
        with pytest.raises(RobotsDisallowed):
            client.fetch(_html())
    assert robots.call_count == 2
    assert not page.called


def test_robots_is_cached_for_24_hours(clock: Clock, router: respx.MockRouter) -> None:
    robots = router.get(ROBOTS).respond(200, text="User-agent: *\nAllow: /\n")
    router.get(PAGE).respond(200)
    client = _client(clock)
    client.fetch(_html())
    client.fetch(_html())
    assert robots.call_count == 1
    clock.t += 25 * 3600
    client.fetch(_html())
    assert robots.call_count == 2


def test_robots_redirect_off_the_allowed_hosts_counts_as_unreachable(
    clock: Clock, router: respx.MockRouter
) -> None:
    router.get(ROBOTS).respond(301, headers={"Location": "https://elsewhere.test/robots.txt"})
    elsewhere = router.get("https://elsewhere.test/robots.txt").respond(200, text="")
    with pytest.raises(RobotsDisallowed):
        _client(clock).fetch(_html())
    assert not elsewhere.called


def test_robots_is_skipped_when_the_source_does_not_require_it(
    clock: Clock, router: respx.MockRouter
) -> None:
    robots = router.get(ROBOTS).respond(200, text="User-agent: *\nDisallow: /\n")
    router.get(PAGE).respond(200)
    _client(clock).fetch(_rest())
    assert not robots.called


def test_a_slow_drip_robots_txt_counts_as_unreachable(clock: Clock, router: respx.MockRouter) -> None:
    def drip() -> Iterator[bytes]:
        for _ in range(3):
            clock.t += 4
            yield b"User-agent: *\n"

    robots = router.get(ROBOTS)
    robots.side_effect = lambda request: httpx.Response(200, content=drip())
    page = router.get(PAGE).respond(200)
    client = _client(clock, http_total_timeout_s=5)
    for _ in range(2):
        with pytest.raises(RobotsDisallowed):
            client.fetch(_html())
    assert robots.call_count == 2, "not cached: the next fetch checks again"
    assert not page.called


# Retries


def test_429_with_retry_after_is_retried_after_the_requested_wait(
    clock: Clock, router: respx.MockRouter
) -> None:
    page = router.get(PAGE)
    page.side_effect = [httpx.Response(429, headers={"Retry-After": "7"}), httpx.Response(200, text="ok")]
    result = _client(clock).fetch(_rest())
    assert isinstance(result, FetchResponse) and result.body == b"ok"
    assert page.call_count == 2
    assert 7.0 in clock.sleeps


def test_retry_after_may_be_an_http_date(clock: Clock, router: respx.MockRouter) -> None:
    when = format_datetime(clock.start + timedelta(seconds=12), usegmt=True)
    router.get(PAGE).side_effect = [httpx.Response(503, headers={"Retry-After": when}), httpx.Response(200)]
    _client(clock).fetch(_rest())
    assert 12.0 in clock.sleeps


def test_a_retry_after_longer_than_five_minutes_fails_instead_of_waiting(
    clock: Clock, router: respx.MockRouter
) -> None:
    router.get(PAGE).respond(429, headers={"Retry-After": "3600"})
    with pytest.raises(FetchError, match="not waiting"):
        _client(clock).fetch(_rest())
    assert all(s < 300 for s in clock.sleeps)


def test_persistent_5xx_gives_up_after_four_attempts(clock: Clock, router: respx.MockRouter) -> None:
    page = router.get(PAGE).respond(502)
    with pytest.raises(HTTPFailure) as caught:
        _client(clock).fetch(_rest())
    assert (caught.value.status, page.call_count) == (502, 4)


def test_network_errors_are_retried(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).side_effect = [httpx.ReadTimeout("slow"), httpx.Response(200, text="ok")]
    assert isinstance(_client(clock).fetch(_rest()), FetchResponse)


def test_other_4xx_is_not_retried(clock: Clock, router: respx.MockRouter) -> None:
    page = router.get(PAGE).respond(404)
    with pytest.raises(HTTPFailure):
        _client(clock).fetch(_rest())
    assert page.call_count == 1


# Conditional GET


def test_304_returns_not_modified_for_the_prior_validators(clock: Clock, router: respx.MockRouter) -> None:
    page = router.get(
        PAGE, headers={"If-None-Match": '"v1"', "If-Modified-Since": "Sat, 26 Sep 2026 00:00:00 GMT"}
    )
    page.respond(304, headers={"ETag": '"v1"'})
    result = _client(clock).fetch(_rest(), etag='"v1"', last_modified="Sat, 26 Sep 2026 00:00:00 GMT")
    assert result == NotModified(PAGE, '"v1"', None)


def test_a_200_carries_the_new_validators_and_checksum(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).respond(200, content=b"abc", headers={"ETag": '"v2"', "Last-Modified": "x"})
    result = _client(clock).fetch(_rest())
    assert isinstance(result, FetchResponse)
    assert (result.etag, result.last_modified) == ('"v2"', "x")
    assert result.sha256 == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


# Size and time guards


def test_a_declared_oversize_body_is_refused(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).respond(200, content=b"x" * (1024 * 1024 + 1))
    with pytest.raises(ResponseTooLarge, match="declares"):
        _client(clock, max_response_mb=1).fetch(_rest())


def test_a_streamed_oversize_body_is_aborted(clock: Clock, router: respx.MockRouter) -> None:
    streamed: list[int] = []

    def chunks() -> Iterator[bytes]:
        for _ in range(8):
            streamed.append(1)
            yield b"x" * 300_000

    router.get(PAGE).mock(return_value=httpx.Response(200, content=chunks()))
    with pytest.raises(ResponseTooLarge, match="exceeded"):
        _client(clock, max_response_mb=1).fetch(_rest())
    assert len(streamed) < 8


def test_a_slow_drip_hits_the_total_timeout(clock: Clock, router: respx.MockRouter) -> None:
    def drip() -> Iterator[bytes]:
        for _ in range(10):
            clock.t += 100
            yield b"x"

    router.get(PAGE).mock(return_value=httpx.Response(200, content=drip()))
    with pytest.raises(FetchError, match="longer than"):
        _client(clock, http_total_timeout_s=250).fetch(_rest())


# Hosts and redirects


def test_a_redirect_to_another_host_is_blocked(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).respond(302, headers={"Location": "https://other.test/x"})
    other = router.get("https://other.test/x").respond(200)
    with pytest.raises(HostNotAllowed):
        _client(clock).fetch(_rest())
    assert not other.called


def test_a_redirect_to_an_allowed_host_is_followed(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).respond(302, headers={"Location": "https://cdn.test/file"})
    router.get("https://cdn.test/file").respond(200, text="moved")
    result = _client(clock).fetch(_rest(allowed_hosts=["cdn.test"]))
    assert isinstance(result, FetchResponse) and result.url == "https://cdn.test/file"


def test_a_redirect_from_https_to_http_is_blocked(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).respond(301, headers={"Location": "http://h.test/page"})
    with pytest.raises(HostNotAllowed, match="https to http"):
        _client(clock).fetch(_rest())


def test_only_the_sources_hosts_are_ever_contacted(clock: Clock, router: respx.MockRouter) -> None:
    evil = router.get("https://evil.test/").respond(200)
    with pytest.raises(HostNotAllowed):
        _client(clock).fetch(_rest(), "https://evil.test/")
    assert not evil.called


def test_every_request_carries_our_user_agent(clock: Clock, router: respx.MockRouter) -> None:
    router.get(ROBOTS).respond(200, text="User-agent: *\nAllow: /\n")
    router.get(PAGE).respond(302, headers={"Location": "/page2"})
    router.get("https://h.test/page2").respond(200)
    _client(clock).fetch(_html())
    assert len(router.calls) == 3
    assert {call.request.headers["user-agent"] for call in router.calls} == {DEFAULT_USER_AGENT}
    assert "@" in DEFAULT_USER_AGENT or "https://" in DEFAULT_USER_AGENT


# Pacing and budget


def test_requests_to_one_host_are_spaced_by_the_rate(clock: Clock, router: respx.MockRouter) -> None:
    router.get(PAGE).respond(200)
    router.get("https://cdn.test/x").respond(200)
    client = _client(clock, default_rate_limit_per_min=30)
    client.fetch(_rest())
    client.fetch(_rest())
    assert clock.sleeps == [2.0]
    client.fetch(_rest(allowed_hosts=["cdn.test"]), "https://cdn.test/x")
    assert clock.sleeps == [2.0], "another host has its own pace"
    client.fetch(_rest(rate_limit_per_min=6))
    assert clock.sleeps == [2.0, 10.0], "the per-source override applies"


def test_crawl_delay_for_our_user_agent_stretches_the_pace(clock: Clock, router: respx.MockRouter) -> None:
    router.get(ROBOTS).respond(200, text="User-agent: TrypTransitDataAgent\nCrawl-delay: 5\nAllow: /\n")
    router.get(PAGE).respond(200)
    client = _client(clock, default_rate_limit_per_min=30)
    client.fetch(_html())
    client.fetch(_html())
    assert clock.sleeps == [5.0, 5.0], "robots.txt, then each page 5 s after the previous request"


def test_the_budget_is_spent_per_request_and_robots_is_free(clock: Clock, router: respx.MockRouter) -> None:
    router.get(ROBOTS).respond(200, text="User-agent: *\nAllow: /\n")
    page = router.get(PAGE).respond(200)
    client, budget = _client(clock), RequestBudget(limit=1)
    client.fetch(_html(), budget=budget)
    with pytest.raises(BudgetExceeded):
        client.fetch(_html(), budget=budget)
    assert page.call_count == 1


def test_retries_spend_the_budget_too(clock: Clock, router: respx.MockRouter) -> None:
    page = router.get(PAGE).respond(503)
    with pytest.raises(BudgetExceeded):
        _client(clock).fetch(_rest(), budget=RequestBudget(limit=2))
    assert page.call_count == 2


def test_logged_urls_drop_query_strings_and_credentials() -> None:
    assert redact("https://user:pw@h.test/a/b?key=SECRET#f") == "https://h.test/a/b"
