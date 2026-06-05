# Used by Glama (and anyone) to build, start, and introspect the Spoken MCP server.
# It's a stdio MCP server; SPOKEN_API_KEY defaults to pt_demo, which is enough
# for tools/list introspection (listing tools makes no API call).
FROM node:22-slim
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build
ENTRYPOINT ["node", "dist/index.js"]
