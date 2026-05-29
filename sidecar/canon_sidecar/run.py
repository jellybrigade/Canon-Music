"""Entry point: python -m canon_sidecar.run"""
import os
import uvicorn

if __name__ == "__main__":
    host = os.environ.get("CANON_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("CANON_SIDECAR_PORT", "8765"))
    uvicorn.run("canon_sidecar.main:app", host=host, port=port, log_level="info")
