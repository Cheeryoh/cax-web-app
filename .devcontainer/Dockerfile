FROM node:20-bookworm-slim

# Install essential dev tools
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  git \
  curl \
  wget \
  unzip \
  gnupg2 \
  procps \
  less \
  jq \
  nano \
  vim \
  fzf \
  sudo \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install PowerShell
RUN curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor \
    | tee /usr/share/keyrings/microsoft-archive-keyring.gpg > /dev/null \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/microsoft-debian-bookworm-prod bookworm main" \
    | tee /etc/apt/sources.list.d/microsoft.list > /dev/null \
  && apt-get update && apt-get install -y powershell \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Give node user sudo access
RUN echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node && \
  chmod 0440 /etc/sudoers.d/node

# Set up npm global dir owned by node
RUN mkdir -p /usr/local/share/npm-global && chown -R node:node /usr/local/share

# Set up workspace
RUN mkdir -p /workspace && chown -R node:node /workspace

WORKDIR /workspace

USER node

# npm global prefix for the node user
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Persist bash history
RUN echo 'export HISTFILE=/workspace/.bash_history' >> ~/.bashrc && \
  echo 'export PROMPT_COMMAND="history -a"' >> ~/.bashrc

ENV DEVCONTAINER=true
