# Hugging Face Space image for the AziralPDF demo.
# __IMAGE_TAG__ is replaced by .github/workflows/docker-publish.yml with the
# tag it just pushed to GHCR (the package must be public).
FROM ghcr.io/azirali/aziralpdf-app:__IMAGE_TAG__

# Spaces run the container as uid 1000; make that the app user so the init
# script finds a writable /configs, /logs, /storage and home directory.
USER root
RUN usermod -o -u 1000 stirlingpdfuser \
    && groupmod -o -g 1000 stirlingpdfgroup \
    && chown -R 1000:1000 /home/stirlingpdfuser /configs /logs /customFiles /pipeline /storage /tmp/stirling-pdf
USER stirlingpdfuser

ENV SERVER_PORT=8080 \
    DISABLE_ADDITIONAL_FEATURES=true \
    SYSTEM_ENABLEANALYTICS=false \
    SYSTEM_MAXFILESIZE=50

EXPOSE 8080
