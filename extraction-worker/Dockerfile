FROM python:3.12-slim
RUN apt-get update && apt-get install --no-install-recommends -y ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 reeltrip \
    && mkdir /data && chown reeltrip:reeltrip /data
WORKDIR /app
COPY travel_workflow ./travel_workflow
COPY service ./service
RUN python -m service.tests.media_smoke
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 REELTRIP_DATA_DIR=/data PORT=8080
# Railway mounts volumes as root. bootstrap prepares /data, then permanently
# drops to uid 10001 before HTTP requests or media processing are accepted.
EXPOSE 8080
CMD ["python", "-m", "service.bootstrap"]
