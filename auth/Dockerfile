FROM python:3.12-slim

WORKDIR /calc/backend/auth

RUN pip install --no-cache-dir flask psycopg2-binary argon2-cffi

COPY auth/ .
COPY common/common.py .

CMD [ "python", "./auth.py" ]

EXPOSE 5001
