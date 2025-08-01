# Dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install
CMD ["bash", "-c", "cd src/getShop && bun main.js demo.csv && cd ../getMenu && bun main.js"]
