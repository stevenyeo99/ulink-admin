# Runtime image for ulink-api on the AWS server (Debian 9 host, Docker 19.03).
# bullseye, not bookworm: Docker 19.03's seccomp blocks bookworm glibc's clone3 (runbook Part 4b).
# poppler-utils: claim recognition shells out to pdftoppm (rasterize.js) and pdftotext (linkedDocuments.js).
# bullseye reached end of life (LTS ended 2026-08): its packages moved from deb.debian.org to archive.debian.org,
# so apt is pointed there (deb.debian.org now returns 404 for bullseye-security packages).
# Build on the server as ulinkai:  docker build -t ulink-api-runtime:22 -f ulink-api-runtime.Dockerfile .
FROM node:22-bullseye-slim
RUN sed -i 's#deb.debian.org#archive.debian.org#g' /etc/apt/sources.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
