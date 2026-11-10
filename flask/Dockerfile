FROM python:3.12-slim

WORKDIR /calc/backend/flask

RUN pip install --no-cache-dir flask psycopg2-binary

COPY flask/ .
COPY common/common.py .

CMD [ "python", "./api.py" ]

EXPOSE 5000
