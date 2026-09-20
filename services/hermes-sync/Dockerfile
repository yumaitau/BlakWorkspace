FROM python:3.12-alpine
WORKDIR /app
COPY sync.py ./
USER 1000:1000
ENTRYPOINT ["python", "sync.py"]
