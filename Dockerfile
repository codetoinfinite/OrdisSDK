FROM node:22-bookworm

WORKDIR /app

# install pyenv & Python 3.13 under /opt, so the unprivileged runtime user can use it
ENV PYENV_ROOT=/opt/pyenv
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        make build-essential libssl-dev zlib1g-dev \
        libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
        libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev git && \
    curl https://pyenv.run | bash && \
    export PATH="$PYENV_ROOT/bin:$PATH" && \
    pyenv install 3.13.0 && \
    pyenv global 3.13.0 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="$PYENV_ROOT/shims:$PYENV_ROOT/bin:$PATH"
ENV PYTHON_VERSION=3.13.0

RUN pip install uv

# install Node dependencies (pnpm 10, as in CI)
RUN npm install -g pnpm@10
# Only what src/ imports: MCP servers listed in package.json are fetched on demand, not baked in
# (installing all of them adds ~9 GB). The lockfile still pins every kept version.
COPY package.json pnpm-lock.yaml ./
COPY scripts/runtime-deps.mjs ./scripts/
COPY src ./src
RUN node scripts/runtime-deps.mjs && pnpm install --no-frozen-lockfile --ignore-scripts
COPY web/package.json web/pnpm-lock.yaml ./web/
RUN pnpm --dir web install --frozen-lockfile

COPY . .

# Python servers run on demand with uvx, each in its own env, so none are installed here.
# (python-mcp/pyproject.toml can't resolve anyway: PyPI yanked some of its packages.)

# build the API and the web app, which the API serves at /
RUN pnpm run build && pnpm web:build

ENV HOST=0.0.0.0
ENV NODE_ENV=production
EXPOSE 3003

# Run as the image's unprivileged `node` user: MCP servers it starts get no root, and the app
# files (owned by root) stay read-only to them. npx/uvx caches go to /home/node.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3003/healthz || exit 1

# node directly (not via pnpm) so SIGTERM reaches the server and it shuts down cleanly
CMD ["node", "--import", "tsx", "src/api/index.ts"]