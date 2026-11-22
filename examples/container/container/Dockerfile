FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends socat git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g @earendil-works/pi-coding-agent@1.6.0
WORKDIR /work
EXPOSE 7000
CMD ["socat", "TCP-LISTEN:7000,reuseaddr,fork", "EXEC:pi --mode rpc --no-session"]
