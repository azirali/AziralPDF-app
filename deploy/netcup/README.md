# AziralPDF production on Netcup

The application at `https://pdf.aziral.com` uses the full proprietary image, including OCR,
LibreOffice, authentication and billing. The GitHub `docker-publish` workflow publishes a
separate ultra-lite demo image; it does not deploy this server and lacks those features.

Production directory: `/opt/aziralpdf`. Persist `configs`, `storage`, `logs`, `customFiles`
and `pipeline`. Keep `smtp.env` and `billing.env` on the server with mode `0600`; commit only
the templates. Never place provider credentials, database backups or account exports in Git.

Build production from the repository root on the existing server builder:

```sh
docker buildx build --builder aziralpdf-build --load \
  --build-arg STIRLING_FLAVOR=proprietary \
  --build-arg VERSION_TAG=<release> \
  -t aziralpdf:<release> -f docker/embedded/Dockerfile .
```

Before switching images, pass `task backend:check` and `task frontend:check`, retain the
previous image/compose file, stop the application and take a consistent backup of `configs`.
Update the image tag, run `docker compose up -d app`, verify health and authenticated
processing, and stop the build container. Roll back the image/compose if verification fails.
Do not replace the shared Caddy configuration used by other sites.

Mail uses Resend SMTP, STARTTLS with certificate verification, and
`AziralPDF <noreply@aziral.com>`. The sender audit records delivery and authentication results
without credentials or recipient identifiers.

Halyk ePay remains disabled until merchant onboarding is complete. See
`halyk-epay-setup.json` for the activation procedure. Never enable live payments or advertise
Apple Pay based only on the integration's presence. Card entry is hosted by the bank;
authoritative payment status, amount, currency and merchant matching gate Pro access.
Subscriptions are prepaid and require manual renewal. Existing release JSON files are
historical evidence, not a replacement for the current image tag in `compose.yml`.
