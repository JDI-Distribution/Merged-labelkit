#!/bin/sh
FLAG="/tmp/.deps_installed"
if [ ! -f "$FLAG" ]; then
    echo "Installing dependencies..."
    python3 -m pip install --no-cache-dir --target /tmp/pypackages -r requirements.txt
    touch "$FLAG"
fi
export PYTHONPATH="/tmp/pypackages:$PYTHONPATH"
echo "Starting server..."
python3 -m uvicorn server:app --host 0.0.0.0 --port "${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-9000}}"
