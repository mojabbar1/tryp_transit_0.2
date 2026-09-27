# Tryp data agent: read API and worker image.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN useradd --create-home --uid 10001 tda

# Dependencies first, so code changes don't invalidate the dependency layer.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY migrations ./migrations
COPY tda ./tda
RUN uv sync --frozen --no-dev && mkdir -p /app/raw /app/inbox && chown -R tda:tda /app

USER tda
ENV PATH="/app/.venv/bin:$PATH" \
    TDA_PROJECT_ROOT=/app
EXPOSE 8081
CMD ["tda", "api", "serve", "--host", "0.0.0.0", "--port", "8081"]
