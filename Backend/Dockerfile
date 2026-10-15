FROM node:24-bookworm-slim

WORKDIR /app

RUN npm install --global pnpm@11.5.3

COPY . .

RUN pnpm install --no-frozen-lockfile \
    && pnpm --filter astrolynx-api build

EXPOSE 5001

CMD ["pnpm", "--filter", "astrolynx-api", "start"]
