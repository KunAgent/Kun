FROM --platform=linux/amd64 ubuntu:22.04 AS build

ARG KUN_APP_VERSION
ARG KUN_ARTIFACT_VERSION
ARG KUN_TAG
ARG KUN_COMMIT

ENV DEBIAN_FRONTEND=noninteractive
ENV KUN_APP_VERSION=${KUN_APP_VERSION}
ENV KUN_ARTIFACT_VERSION=${KUN_ARTIFACT_VERSION}
ENV KUN_UPDATE_CHANNEL=frontier
ENV RELEASE_CHANNEL=frontier

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git python3 tar xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSLO https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz \
    && echo "9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578  node-v22.23.1-linux-x64.tar.xz" | sha256sum -c - \
    && tar -xJf node-v22.23.1-linux-x64.tar.xz -C /usr/local --strip-components=1 \
    && rm node-v22.23.1-linux-x64.tar.xz \
    && node --version \
    && npm --version

WORKDIR /src
COPY . .
RUN npm ci \
    && npm --prefix kun ci \
    && npm run build:kun \
    && npm run package:tui -- \
      --version "${KUN_APP_VERSION}" \
      --artifact-version "${KUN_ARTIFACT_VERSION}" \
      --tag "${KUN_TAG}" \
      --channel frontier \
      --commit "${KUN_COMMIT}" \
      --target linux-x64 \
      --output dist/benchmark-tui

FROM scratch AS export
COPY --from=build /src/dist/benchmark-tui/ /
