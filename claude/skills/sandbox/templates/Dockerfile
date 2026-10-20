# Claude sandbox image. Debian devcontainer base ships a non-root 'vscode' user
# (uid 1000, passwordless sudo): --dangerously-skip-permissions refuses to run
# as root, and sudo lets Claude install extra software inside the sandbox.
FROM mcr.microsoft.com/devcontainers/base:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg git less jq ripgrep build-essential \
    && rm -rf /var/lib/apt/lists/*

# --- Node.js LTS + Claude Code --------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code

# --- GitHub CLI -----------------------------------------------------------
# The token is never baked in: the launcher passes GH_TOKEN at start-up (only
# when the sandbox has GitHub access). git uses gh as its credential helper.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system credential.https://github.com.helper '!gh auth git-credential'

# >>> R (drop this block if R is not needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gfortran libcurl4-openssl-dev libssl-dev libxml2-dev \
    && rm -rf /var/lib/apt/lists/*
RUN curl -Ls https://github.com/r-lib/rig/releases/download/latest/rig-linux-$(arch)-latest.tar.gz \
        | tar xz -C /usr/local \
    && rig add release \
    && rig default release
RUN Rscript -e 'install.packages("pak", repos = sprintf("https://r-lib.github.io/p/pak/stable/%s/%s/%s", .Platform$pkgType, R.Version()$os, R.Version()$arch))'
# <<< R

# >>> Python (drop this block if Python/conda is not needed)
RUN curl -fsSL -o /tmp/miniforge.sh \
        https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-$(uname -m).sh \
    && bash /tmp/miniforge.sh -b -p /opt/conda \
    && rm /tmp/miniforge.sh \
    && chown -R vscode:vscode /opt/conda \
    && echo 'source /opt/conda/etc/profile.d/conda.sh' >> /home/vscode/.bashrc
# <<< Python

# >>> Notify (Slack DMs to the owner via the host relay; drop if SANDBOX_NOTIFY is "0")
# MCP server + hooks, read-only for Claude. The Slack token stays on the host.
COPY notify/ /opt/sandbox-notify/
# <<< Notify

# Login/session dirs for the two Claude accounts. Named volumes are mounted
# here (see devcontainer.json); creating them owned by vscode makes the fresh
# volumes inherit that ownership.
RUN mkdir -p /home/vscode/.claude /home/vscode/.claude-sci \
    && chown -R vscode:vscode /home/vscode/.claude /home/vscode/.claude-sci
ENV CLAUDE_CONFIG_DIR=/home/vscode/.claude
