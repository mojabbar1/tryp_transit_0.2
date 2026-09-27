"""robots.txt per RFC 9309 (review finding F6): cases ``urllib.robotparser`` gets wrong, and more."""

from __future__ import annotations

import time

import pytest

from tda.config.settings import DEFAULT_USER_AGENT
from tda.http.robots import normalize, parse, product_token

UA = DEFAULT_USER_AGENT


def _allows(robots: str, path: str) -> bool:
    return parse(robots, UA).allows(f"https://h.test{path}")


def test_our_product_token() -> None:
    assert product_token(UA) == "TrypTransitDataAgent"


@pytest.mark.parametrize(
    ("robots", "path", "allowed"),
    [
        # Astra's reproductions: wildcards, merged groups, longest match.
        ("User-agent: *\nDisallow: /private/*\n", "/private/record", False),
        (
            "User-agent: TrypTransitDataAgent\nDisallow: /a\n\n"
            "User-agent: TrypTransitDataAgent\nDisallow: /b\n",
            "/b/page",
            False,
        ),
        ("User-agent: *\nDisallow: /\nAllow: /public/\n", "/public/record", True),
        ("User-agent: *\nDisallow: /\nAllow: /public/\n", "/private/record", False),
        # `$` anchors the end; without it a rule is a prefix.
        ("User-agent: *\nDisallow: /*.pdf$\n", "/docs/report.pdf", False),
        ("User-agent: *\nDisallow: /*.pdf$\n", "/docs/report.pdf?page=2", True),
        ("User-agent: *\nDisallow: /*.pdf$\n", "/docs/report.pdfx", True),
        ("User-agent: *\nDisallow: /fish\n", "/fish.html", False),
        ("User-agent: *\nDisallow: /fish\n", "/Fish.html", True),
        # Equal length: allow wins; longer beats shorter whichever comes first.
        ("User-agent: *\nDisallow: /page\nAllow: /page\n", "/page", True),
        ("User-agent: *\nAllow: /folder\nDisallow: /folder/secret\n", "/folder/secret/x", False),
        ("User-agent: *\nDisallow: /folder\nAllow: /folder/open\n", "/folder/open/x", True),
        # Query strings are part of the matched path.
        ("User-agent: *\nDisallow: /search?q=\n", "/search?q=bus", False),
        # An empty Disallow allows everything; /robots.txt is always allowed.
        ("User-agent: *\nDisallow:\n", "/anything", True),
        ("User-agent: *\nDisallow: /\n", "/robots.txt", True),
        # No groups at all: allowed.
        ("# nothing here\n", "/x", True),
    ],
)
def test_rules(robots: str, path: str, allowed: bool) -> None:
    assert _allows(robots, path) is allowed


def test_our_group_replaces_star_and_other_bots_groups_do_not_apply() -> None:
    robots = (
        "User-agent: *\nDisallow: /\n\n"
        "User-agent: tryptransitdataagent/1.0\nAllow: /\n\n"
        "User-agent: OtherBot\nDisallow: /x\n"
    )
    assert _allows(robots, "/x")
    assert not parse("User-agent: OtherBot\nAllow: /\n\nUser-agent: *\nDisallow: /\n", UA).allows("/x")


def test_user_agents_match_by_whole_token_not_substring() -> None:
    # robotparser would apply a "Tryp" group to "TrypTransitDataAgent"; RFC 9309 does not.
    robots = "User-agent: Tryp\nDisallow: /\n\nUser-agent: *\nAllow: /\n"
    assert _allows(robots, "/page")


def test_consecutive_user_agent_lines_share_one_group() -> None:
    robots = "User-agent: OtherBot\nUser-agent: TrypTransitDataAgent\nDisallow: /shared\n"
    assert not _allows(robots, "/shared/x")


def test_rules_before_any_group_are_ignored_and_comments_and_crlf_are_handled() -> None:
    robots = "Disallow: /early\r\nUser-agent: *  # everyone\r\nDisallow: /late # comment\r\n"
    assert _allows(robots, "/early")
    assert not _allows(robots, "/late/x")


def test_percent_encoding_is_normalized() -> None:
    assert normalize("/%7ejoe/") == "/~joe/"
    assert normalize("/a%2fb") == "/a%2Fb", "reserved characters stay encoded (uppercase hex)"
    assert normalize("/bär") == "/b%C3%A4r"
    assert not _allows("User-agent: *\nDisallow: /%7Ejoe/\n", "/~joe/index.html")
    assert not _allows("User-agent: *\nDisallow: /foo/bär\n", "/foo/b%C3%A4r")
    assert _allows("User-agent: *\nDisallow: /a%2Fb\n", "/a/b")


def test_crawl_delay_comes_from_the_matching_groups() -> None:
    robots = "User-agent: *\nCrawl-delay: 30\n\nUser-agent: TrypTransitDataAgent\nCrawl-delay: 4\nAllow: /\n"
    assert parse(robots, UA).crawl_delay == 4.0
    assert parse("User-agent: *\nCrawl-delay: soon\n", UA).crawl_delay is None


def test_figure_4_of_rfc_9309_section_2_2_2() -> None:
    """Review round 2, R2-3: every row of Figure 4 (path -> the path to match)."""
    assert normalize("/foo/bar?baz=quz") == "/foo/bar?baz=quz"
    assert normalize("/foo/bar?baz=https://foo.bar") == "/foo/bar?baz=https%3A%2F%2Ffoo.bar"
    assert normalize("/foo/bar/\u30c4") == "/foo/bar/%E3%83%84"
    assert normalize("/foo/bar/%E3%83%84") == "/foo/bar/%E3%83%84"
    assert normalize("/foo/bar/%62%61%7A") == "/foo/bar/baz"


@pytest.mark.parametrize(
    ("rule", "path", "allowed"),
    [
        ("/foo/bar?baz=https://foo.bar", "/foo/bar?baz=https%3A%2F%2Ffoo.bar", False),
        ("/foo/bar?baz=https%3A%2F%2Ffoo.bar", "/foo/bar?baz=https://foo.bar", False),
        ("/private[1]", "/private%5B1%5D", False),
        ("/private%5B1%5D", "/private[1]", False),
        ("/a%2Fb", "/a/b", True),
        ("/a/b", "/a%2Fb", True),
        ("/q?x=a&y=b", "/q?x=a&y=b", False),
        ("/q?x=a%26y=b", "/q?x=a&y=b", True),
        ("/path/file-with-a-%2A.html", "/path/file-with-a-*.html", False),
        ("/path/foo-%24", "/path/foo-$", False),
        ("/user:@/*", "/user:@/x", False),
    ],
)
def test_reserved_data_is_compared_encoded_and_separators_stay_structural(
    rule: str, path: str, allowed: bool
) -> None:
    """Round 2, R2-3: reserved characters that are data compare encoded; ``/ ? & =`` stay structural."""
    assert _allows(f"User-agent: *\nDisallow: {rule}\n", path) is allowed


def test_many_wildcards_on_a_mismatch_finish_in_linear_time() -> None:
    """Review round 2, R2-2: the pattern that stalled a backtracking regex for more than 3 s."""
    started = time.perf_counter()
    assert parse("User-agent: *\nDisallow: /" + "*a" * 24 + "b\n", UA).allows("/" + "a" * 36)
    assert parse("User-agent: *\nDisallow: /" + "*a" * 2000 + "b\n", UA).allows("/" + "a" * 4000)
    assert time.perf_counter() - started < 0.5
