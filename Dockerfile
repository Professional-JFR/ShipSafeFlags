FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci
COPY apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["npm", "run", "dev"]
