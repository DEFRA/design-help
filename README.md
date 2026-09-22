# design-help

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_design-help&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_design-help)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_design-help&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_design-help)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_design-help&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_design-help)

**Defra DDTS Design help** — an internal directory where the Defra design community finds and offers support: profiles, availability, offers and requests, long-term helping, and GDaD (DDaT) design skills evidence with line-manager review.

This is the frontend service (Hapi + Nunjucks + GOV.UK Frontend, sessions in Redis). All data lives behind the companion API, [design-help-backend](https://github.com/DEFRA/design-help-backend) (Hapi + MongoDB). It is a port of the original [GOV.UK Prototype Kit prototype](https://github.com/defra-design/design-help) onto Defra's Core Delivery Platform; the Postgres/Passport prototype architecture was replaced with a backend API and passwordless magic-link sign-in.

- [Service overview](#service-overview)
- [Configuration](#configuration)
- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Server-side Caching](#server-side-caching)
- [Redis](#redis)
- [Local Development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Update dependencies](#update-dependencies)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Service overview

- **Sign in**: passwordless. An allow-listed email requests a single-use, 15-minute sign-in link sent via GOV.UK Notify. In local development (no Notify key) the link is logged to the console instead. Access is managed by admins on the People and access page.
- **Directory**: browse/search team members, profile pages, offers (what people can help with) and requests (what people want help with), long-term helping with availability.
- **Admin**: people and access management, add-profile wizard, line-manager identification and allocations (Head of Design only), admin grant/revoke (Head of Design only; bootstrap admins from `ADMIN_EMAILS` cannot be revoked).
- **GDaD**: designers keep STAR evidence for the seven DDaT design skills (typed or CSV import); line managers and admins review and score; capability banding from the best six scores.

Local development needs the backend running (see its README) and a `.env` such as:

```
PORT=3199
BACKEND_API_URL=http://localhost:3198
ADMIN_EMAILS=you@defra.gov.uk
GDAD_HEAD_OF_DESIGN_EMAILS=you@defra.gov.uk
```

## Configuration

Non-secret config lives in `cdp-app-config` per environment; secrets in the CDP Portal Secrets tab. Everything arrives as environment variables and is read once at container start — config changes need a redeploy, not a rebuild.

| Variable                        | Kind       | Purpose                                                                                                                   |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_API_URL`               | config     | Base URL of design-help-backend (e.g. `https://design-help-backend.dev.cdp-int.defra.cloud`)                              |
| `APP_BASE_URL`                  | config     | Public base URL of this service, used to build sign-in links                                                              |
| `ADMIN_EMAILS`                  | config     | Comma-separated bootstrap admins (always admin, cannot be revoked in-app)                                                 |
| `GDAD_HEAD_OF_DESIGN_EMAILS`    | config     | Emails allowed the Head of Design super-user role and job title                                                           |
| `NOTIFY_MAGIC_LINK_TEMPLATE_ID` | config     | Notify template with `((sign_in_link))` personalisation                                                                   |
| `NOTIFY_FEEDBACK_TEMPLATE_ID`   | config     | Notify template with `((service_name))`, `((feedback_details))`, `((page_path))`, `((contact_email))`, `((signed_in_as))` |
| `FEEDBACK_INBOX_EMAIL`          | config     | Inbox that receives service feedback                                                                                      |
| `MAGIC_LINK_TTL`                | config     | Sign-in link TTL in ms (default 15 minutes)                                                                               |
| `NOTIFY_API_KEY`                | **secret** | GOV.UK Notify API key                                                                                                     |
| `SESSION_COOKIE_PASSWORD`       | **secret** | At least 32 characters                                                                                                    |

In production, sign-in is restricted to `@defra.gov.uk` addresses and refuses to run without Notify configured. Outside production any allow-listed address works and links/feedback are logged instead of emailed.

## Requirements

### Node.js

Please install Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd design-help
nvm use
```

## Server-side Caching

We use Catbox for server-side caching. By default the service will use CatboxRedis when deployed and CatboxMemory for
local development.
You can override the default behaviour by setting the `SESSION_CACHE_ENGINE` environment variable to either `redis` or
`memory`.

Please note: CatboxMemory (`memory`) is _not_ suitable for production use! The cache will not be shared between each
instance of the service and it will not persist between restarts.

## Redis

Redis is an in-memory key-value store. Every instance of a service has access to the same Redis key-value store similar
to how services might have a database (or MongoDB). All frontend services are given access to a namespaced prefixed that
matches the service name. e.g. `my-service` will have access to everything in Redis that is prefixed with `my-service`.

If your service does not require a session cache to be shared between instances or if you don't require Redis, you can
disable setting `SESSION_CACHE_ENGINE=false` or changing the default value in `src/config/index.js`.

## Proxy

We are using forward-proxy which is set up by default. Services are automatically configured with the proxy environment variables when deployed.

Node.js 24 uses these variables to route outbound HTTP(S) requests through the proxy:

NODE_USE_ENV_PROXY=1
HTTPS_PROXY=...
NO_PROXY=...

No additional proxy configuration is required in the service.

## Local Development

### Setup

Install application dependencies:

```bash
npm install
```

### Git hooks

Install git hooks (optional)

```bash
npm run git:hooks
```

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json)
To view them in your command line run:

```bash
npm run
```

### Update dependencies

To update dependencies use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

> The following script is a good start. Check out all the options on
> the [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

```bash
ncu --interactive --format group
```

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## Docker

### Development image

> [!TIP]
> For Apple Silicon users, you may need to add `--platform linux/amd64` to the `docker run` command to ensure
> compatibility fEx: `docker build --platform=linux/arm64 --no-cache --tag design-help`

Build:

```bash
docker build --target development --no-cache --tag design-help:development .
```

Run:

```bash
docker run -p 3000:3000 design-help:development
```

### Production image

Build:

```bash
docker build --no-cache --tag design-help .
```

Run:

```bash
docker run -p 3000:3000 design-help
```

### Docker Compose

A local environment with:

- Floci (replacing Localstack) for AWS services (S3, SQS)
- Redis
- MongoDB
- This service.
- A commented out backend example.

```bash
docker compose up --build -d
```

### Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

### SonarCloud

Instructions for setting up SonarCloud can be found in [sonar-project.properties](./sonar-project.properties).

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
