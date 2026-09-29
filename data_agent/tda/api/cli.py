"""``tda api``: serve the read API, or write its OpenAPI snapshot."""

from __future__ import annotations

import typer

from tda.cli_support import cli_errors
from tda.config.settings import get_settings

api_app = typer.Typer(help="The read API.", no_args_is_help=True)


@api_app.command()
@cli_errors
def serve(
    host: str = typer.Option("127.0.0.1", help="Bind address (use 0.0.0.0 inside a container)."),
    port: int | None = typer.Option(None, help="Default: TDA_API_PORT (8081)."),
) -> None:
    """Serve /v1/* as tda_reader (TDA_READER_DATABASE_URL), with no access log (see below)."""
    import uvicorn

    from tda.api.app import create_app

    settings = get_settings()
    # No access log: request URLs carry a rider's coordinates and stop pairs (/v1/stops/nearest, /v1/compare),
    # and Uvicorn's access log would keep them next to the client address. The API keeps nothing per request.
    uvicorn.run(
        create_app(settings=settings),
        host=host,
        port=port or settings.api_port,
        log_level="info",
        access_log=False,
    )


@api_app.command()
@cli_errors
def openapi() -> None:
    """Write contracts/data-agent.openapi.json (commit it; CI checks for drift)."""
    from tda.api.openapi import write

    typer.echo(f"wrote {write(get_settings())}")
