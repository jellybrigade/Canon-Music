FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY canon_sidecar ./canon_sidecar

ENV CANON_SIDECAR_HOST=0.0.0.0
ENV CANON_SIDECAR_PORT=8765

EXPOSE 8765

CMD ["python", "-m", "canon_sidecar.run"]
