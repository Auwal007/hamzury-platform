FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock ./
RUN apt-get update && apt-get install -y --no-install-recommends clamav clamav-freshclam age ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.lock \
    && useradd --create-home --uid 10001 hamzury
COPY server.py catalogue.py ./
COPY static/ ./static/
COPY tools/ ./tools/
RUN mkdir -p /app/data /var/lib/clamav /var/log/clamav \
    && chown -R hamzury:hamzury /app/data /var/lib/clamav /var/log/clamav
USER hamzury
EXPOSE 8000
# the port is published on 127.0.0.1 only (compose.yaml), so the only caller is your https proxy: trust its forwarded client address
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/api/health',timeout=4)"
CMD ["python","tools/run.py"]
