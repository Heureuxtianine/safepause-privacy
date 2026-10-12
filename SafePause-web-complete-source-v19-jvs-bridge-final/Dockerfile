FROM node:20-alpine
WORKDIR /app
COPY package.json server.mjs mcp.mjs device-bridge.mjs ai.mjs agent-skill.md index.html styles.css app.js ./
ENV SAFEPAUSE_HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["node", "server.mjs"]
