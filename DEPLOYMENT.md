# LedgerBranch POS — Cloud Deployment & Operations Guide

## 1. Architecture Overview
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (Vite bundle served by Express in production).
- **Backend Gateway**: Node.js + Express (`server.ts` -> `server.js`) listening on `PORT=3000`. Verifies Firebase ID tokens (`verifyIdToken`), rate-limits `/api/*`, validates POS checkout totals with Zod, and streams formula-safe CSV exports.
- **Database & Auth**: Firebase Authentication (Google + Email/Password) + Cloud Firestore (`fast-wares-5f900` / `ai-studio-c407e108-91a5-4af6-afa9-6e7048272a3f`), protected by hardened `firestore.rules`.

## 2. Build & Verification Commands
```bash
npm ci
npm run lint
npm test
npm run build
```

## 3. Google Cloud Run Deployment (Least-Privilege IAM)
1. **Create Dedicated Service Account**:
   ```bash
   gcloud iam service-accounts create ledgerbranch-pos-runner \
     --display-name="LedgerBranch POS Cloud Run Runner"
   ```
2. **Grant Minimal Roles** (Logging & Secret Manager accessor only if optional server secrets are attached):
   ```bash
   gcloud projects add-iam-policy-binding fast-wares-5f900 \
     --member="serviceAccount:ledgerbranch-pos-runner@fast-wares-5f900.iam.gserviceaccount.com" \
     --role="roles/logging.logWriter"
   ```
3. **Deploy to Cloud Run**:
   ```bash
   gcloud run deploy ledgerbranch-pos \
     --source . \
     --platform managed \
     --region europe-west1 \
     --port 3000 \
     --service-account ledgerbranch-pos-runner@fast-wares-5f900.iam.gserviceaccount.com \
     --allow-unauthenticated
   ```
4. **Deploy Firestore Rules & Composite Indexes**:
   ```bash
   npx eslint firestore.rules
   firebase deploy --only firestore:rules,firestore:indexes
   ```

## 4. Secret Management & Environment Variables
- Never commit `.env` or private service account keys to source control.
- Store optional third-party payment gateway secrets (Mobile Money / Card webhooks) in **Google Secret Manager** and bind them with `--set-secrets` in Cloud Run.
- External payment methods (`mobile_money`, `card`, `bank_transfer`) currently operate as **manual confirmation** until gateway webhook credentials are configured.

## 5. Logging, Monitoring & Firestore Backups
- **Structured Request Tracing**: Every `/api/*` request attaches a unique `x-request-id` header and logs latency/status for Cloud Logging.
- **Health Endpoint**: Configure Cloud Run liveness & startup probes on `GET /api/health`.
- **Backup & Recovery**: Enable scheduled Firestore daily exports to a regional Cloud Storage bucket with object versioning (`gcloud firestore backups schedules create`) and 30-day retention.
