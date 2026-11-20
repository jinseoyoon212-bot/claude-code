# Session Web relay, built from the repository root so Render's default settings work
# (Dockerfile path ./Dockerfile, build context ., no root directory).
# The relay itself is web/relay/server.js, see web/README.md.
FROM node:24-alpine
WORKDIR /app
COPY web/relay/server.js .
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.js"]
