FROM node:20
WORKDIR /app
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 3001
CMD ["node", "src/runner.js"]
