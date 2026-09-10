.PHONY: start stop restart down rebuild build logs status ingest

# mobile-design-guide MCP server: long-lived HTTP, container-only, on 127.0.0.1:8767/mcp
IMAGE := mobile-design-guide:latest

# start/stop keep the container around so Docker UI Start/Stop works too
start:
	docker compose up -d

stop:
	docker compose stop

restart:
	docker compose restart

# remove the container entirely (start recreates it)
down:
	docker compose down

rebuild:
	docker compose up -d --build

logs:
	docker compose logs -f

status:
	docker compose ps

build:
	docker compose build

# one-shot ingest against the same mounted db
ingest: build
	docker run --rm --name mobile-design-guide-ingest --no-healthcheck --env-file .env \
	  -v $(PWD)/data:/app/data -v $(PWD)/.cache:/app/.cache \
	  --entrypoint node $(IMAGE) dist/ingest.js
