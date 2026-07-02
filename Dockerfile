FROM python:3.11-slim

LABEL org.opencontainers.image.title="Label Kits" \
    org.opencontainers.image.description="Michaels and KeHE label workflows" \
    org.opencontainers.image.source="https://github.com/JDI-Distribution/Merged-labelkit"

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

COPY frankenstein_project/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY frankenstein_project/ ./

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:9000/health', timeout=4).getcode()==200 else 1)"

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-9000}}"]
