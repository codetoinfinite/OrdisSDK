FROM node:22-bookworm

WORKDIR /app

# install pyenv & Python 3.13
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        make build-essential libssl-dev zlib1g-dev \
        libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
        libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev git && \
    curl https://pyenv.run | bash && \
    export PATH="/root/.pyenv/bin:$PATH" && \
    pyenv install 3.13.0 && \
    pyenv global 3.13.0 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.pyenv/shims:/root/.pyenv/bin:$PATH"
ENV PYTHON_VERSION=3.13.0

RUN pip install uv

# install Node dependencies (pnpm 10, as in CI)
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY web/package.json web/pnpm-lock.yaml ./web/
RUN pnpm --dir web install --frozen-lockfile

COPY . .

# Python servers run on demand with uvx, each in its own env, so none are installed here.
# (python-mcp/pyproject.toml can't resolve anyway: PyPI yanked some of its packages.)

# build the API and the web app, which the API serves at /
RUN pnpm run build && pnpm web:build

ENV HOST=0.0.0.0
EXPOSE 3003

CMD ["pnpm", "start"]