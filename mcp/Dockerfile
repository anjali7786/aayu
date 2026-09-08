FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV TOOLBOX_VERSION=v1.10.0

RUN curl -fsSL \
      "https://storage.googleapis.com/mcp-toolbox-for-databases/${TOOLBOX_VERSION}/linux/amd64/toolbox" \
      -o /usr/local/bin/toolbox \
    && chmod +x /usr/local/bin/toolbox

WORKDIR /app
COPY tools.yaml /app/tools.yaml

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "exec toolbox --tools-file /app/tools.yaml --address 0.0.0.0 --port ${PORT}"]
