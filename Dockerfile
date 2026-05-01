FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY server.js ./
COPY public ./public

ENV PORT=5173
EXPOSE 5173

CMD ["npm", "start"]
