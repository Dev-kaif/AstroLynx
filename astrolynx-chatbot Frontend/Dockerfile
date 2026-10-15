FROM node:24-bookworm-slim

WORKDIR /app

RUN npm install --global pnpm@11.5.3

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:5001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY . .

RUN pnpm install --no-frozen-lockfile \
    && pnpm --filter astrolynx-web build

EXPOSE 3000

CMD ["pnpm", "--filter", "astrolynx-web", "start"]
