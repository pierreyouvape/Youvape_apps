FROM node:20-alpine

WORKDIR /app

# ffmpeg : compression des stories vidéo (app Stories, storyProcessingService)
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]