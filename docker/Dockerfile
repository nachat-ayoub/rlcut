FROM node:22-bookworm-slim AS node
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev \
    librsvg2-dev libayatana-appindicator3-dev patchelf ffmpeg python3 \
    gstreamer1.0-tools gstreamer1.0-libav gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good libgstreamer1.0-dev \
    ca-certificates curl git file desktop-file-utils squashfs-tools \
    dbus-x11 xauth xvfb x11-utils fonts-dejavu-core \
    xdg-utils shared-mime-info mesa-utils libgl1-mesa-dri \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal --component rustfmt --component clippy \
    && rm /tmp/rustup.sh && chmod -R a+rX /opt/rustup /opt/cargo
WORKDIR /workspace
