FROM python:3.12-alpine
WORKDIR /app
COPY sync.py content-sources.json access.py directory.py http_client.py app-grants.json ./
RUN python -c "import sync"
USER 1000:1000
ENTRYPOINT ["python", "sync.py"]
