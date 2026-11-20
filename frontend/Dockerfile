# 1) Compilar Angular
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install --no-audit --no-fund
COPY . .
RUN NG_CLI_ANALYTICS=false npx ng build --progress=false

# 2) Servir con Nginx (y redirigir /api, /ws y /media al backend)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
