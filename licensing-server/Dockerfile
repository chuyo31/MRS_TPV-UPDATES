FROM node:20-alpine

WORKDIR /app

COPY licensing-server/package.json ./
RUN npm install --omit=dev

COPY licensing-server/src ./src
COPY licensing-server/sql ./sql
COPY licensing-admin ./licensing-admin

EXPOSE 4040

CMD ["npm", "start"]
