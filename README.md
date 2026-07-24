# Stremio Library Importer

Transfer saved library items (movies/series, including watch progress) from one Stremio account to another using the official Stremio API.

> **Note:** Stremio’s official “Export user data” JSON is often incomplete or duplicated. This tool reads the live library via `datastoreGet` instead.

## Requirements

- Node.js 18+
- Email/password for both the source and target Stremio accounts

## Setup

```bash
cp .env.example .env
npm install
```

Edit `.env`:

```env
SOURCE_EMAIL=old@example.com
SOURCE_PASSWORD=...

TARGET_EMAIL=new@example.com
TARGET_PASSWORD=...
```

## Usage

Preview what would be transferred (no writes):

```bash
npm run dry-run
# or: node src/transfer.js --dry-run
```

Transfer to the target account:

```bash
npm run transfer
# or: node src/transfer.js
```

## Behavior

- Skips items marked `removed` or `temp` on the source
- Merges into the target library (does not wipe existing target items)
- Writes in batches of 50
- Never prints passwords or full auth keys

## Out of scope

- Addon migration
- Trakt / Nuvio / Letterboxd export
- Fixing Stremio’s official export JSON
