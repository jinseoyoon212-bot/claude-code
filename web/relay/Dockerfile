# Session Web relay image. Build from the REPOSITORY ROOT (the build context must contain
# web/relay/server.js), e.g.:
#   docker build -f web/relay/Dockerfile -t session-relay .
# On Render: Dockerfile Path = web/relay/Dockerfile, Docker Build Context Directory = .
FROM node:24-alpine
WORKDIR /app
COPY web/relay/server.js .
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.js"]
