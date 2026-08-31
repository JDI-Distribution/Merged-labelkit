FROM python:3.11.9-slim-bookworm

ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Label Kits" \
    org.opencontainers.image.description="Michaels, KeHE, MPL, Ti-Hi, and B2B case-pack label workflows" \
    org.opencontainers.image.source="https://github.com/JDI-Distribution/Merged-labelkit" \
    org.opencontainers.image.version="${APP_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_NAME="Label Kits" \
    PORT=9000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system labelkit && useradd --system --gid labelkit --home-dir /app labelkit

COPY frankenstein_project/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade "pip>=25.2,<26" && \
    python -m pip install --no-cache-dir -r requirements.txt

COPY --chown=labelkit:labelkit frankenstein_project/ ./

EXPOSE 9000

USER labelkit

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request,sys; port=os.getenv('X_ZOHO_CATALYST_LISTEN_PORT') or os.getenv('PORT') or '9000'; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=4).getcode()==200 else 1)"

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-9000}}"]
