FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Install system deps needed by google-cloud-* + grpc
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (better layer caching)
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy only the runtime code paths (skip data/, docs/, .venv/, bin/, app/, check/)
COPY api/       /app/api/
COPY agents/    /app/agents/
COPY model/     /app/model/
COPY reasoning/ /app/reasoning/

EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
