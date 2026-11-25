# Multi-Branch POS System — Multi-Tenant SaaS & Enterprise Cloud Deployment Guide

## 1. Architecture Overview
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (Vite bundle served by Express in production).
- **Backend Gateway**: Node.js + Express (`server.ts` -> `server.js`) listening on `PORT=3000`.
  - Verifies Firebase ID tokens (`verifyIdToken`), tenant memberships (`requireTenantMember`), feature/quota entitlements (`requireFeature` / `requireQuota`), and platform Super Admin privileges (`requirePlatformAdmin`).
  - Handles Paystack Card & Ghanaian Mobile Money checkouts and authenticates webhooks via HMAC-SHA512 over raw request bytes (`req.rawBody`).
- **Database & Auth**: Firebase Authentication (Google + Email/Password) + Cloud Firestore (`fast-wares-5f900` / `ai-studio-c407e108-91a5-4af6-afa9-6e7048272a3f`), protected by strict tenant-isolated `firestore.rules`.

## 2. Build & Verification Commands
```bash
npm ci
npm run lint
npm test
npx eslint firestore.rules
npm run build
```

## 3. Shared Multi-Tenant SaaS Cloud Run Deployment
Standard Starter, Professional, and Business Plus retail tenants share one Cloud Run service with strict logical tenant isolation enforced in both Express middleware and `firestore.rules`.

1. **Create Dedicated Service Account**:
   ```bash
   gcloud iam service-accounts create pos-saas-runner \
     --display-name="Multi-Branch POS SaaS Cloud Run Runner"
   ```
2. **Grant Least-Privilege IAM Roles** (Cloud Logging + Firestore Admin SDK access):
   ```bash
   gcloud projects add-iam-policy-binding fast-wares-5f900 \
     --member="serviceAccount:pos-saas-runner@fast-wares-5f900.iam.gserviceaccount.com" \
     --role="roles/logging.logWriter"

   gcloud projects add-iam-policy-binding fast-wares-5f900 \
     --member="serviceAccount:pos-saas-runner@fast-wares-5f900.iam.gserviceaccount.com" \
     --role="roles/datastore.user"
   ```
3. **Store Payment Secrets in Google Secret Manager** (never commit keys):
   ```bash
   printf "%s" "$PAYSTACK_SECRET_KEY" | gcloud secrets create PAYSTACK_SECRET_KEY --data-file=-
   printf "%s" "$PAYSTACK_WEBHOOK_SECRET" | gcloud secrets create PAYSTACK_WEBHOOK_SECRET --data-file=-
   ```
4. **Deploy Shared SaaS Service to Cloud Run**:
   ```bash
   gcloud run deploy pos-saas-shared \
     --source . \
     --platform managed \
     --region europe-west1 \
     --port 3000 \
     --service-account pos-saas-runner@fast-wares-5f900.iam.gserviceaccount.com \
     --set-env-vars "NODE_ENV=production,DEPLOYMENT_MODE=shared,VITE_DEPLOYMENT_MODE=shared,APP_URL=https://pos.yourdomain.com,PLATFORM_ADMIN_EMAILS=appiahkubi848@gmail.com" \
     --set-secrets "PAYSTACK_SECRET_KEY=PAYSTACK_SECRET_KEY:latest,PAYSTACK_WEBHOOK_SECRET=PAYSTACK_WEBHOOK_SECRET:latest" \
     --allow-unauthenticated
   ```
5. **Configure Paystack Webhook Endpoint**:
   Point your Paystack Dashboard webhook URL to `https://pos.yourdomain.com/api/billing/webhooks/paystack`.
6. **Deploy Firestore Security Rules & Composite Indexes**:
   ```bash
   npx eslint firestore.rules
   firebase deploy --only firestore:rules,firestore:indexes
   ```

## 4. Dedicated Single-Tenant Enterprise Deployment
Enterprise customers requiring physical infrastructure isolation deploy the exact same codebase into their own Google Cloud project, Firebase Auth domain, named Firestore database, and Cloud Run service:

1. Provision a dedicated GCP Project (`enterprise-client-prod`), Firebase Web App config (`firebase-applet-config.json`), and Firestore database (`FIRESTORE_DATABASE_ID`).
2. Assign `roles/datastore.user` and `roles/logging.logWriter` to the client's Cloud Run runner service account.
3. Build and deploy with `DEPLOYMENT_MODE=dedicated` and bind the deployment to the client's single tenant ID:
   ```bash
   gcloud run deploy pos-enterprise-client \
     --source . \
     --platform managed \
     --region europe-west1 \
     --port 3000 \
     --set-env-vars "NODE_ENV=production,DEPLOYMENT_MODE=dedicated,DEDICATED_TENANT_ID=org_enterprise_001,VITE_DEPLOYMENT_MODE=dedicated,VITE_DEDICATED_TENANT_ID=org_enterprise_001,FIREBASE_PROJECT_ID=enterprise-client-prod,FIRESTORE_DATABASE_ID=(default)"
   ```
4. In `dedicated` mode, backend middleware rejects cross-tenant requests where `organizationId !== DEDICATED_TENANT_ID`, and the frontend disables public new-business signups.

## 5. Logging, Monitoring & Firestore Backups
- **Structured Cloud Logging**: Every `/api/*` request attaches an `x-request-id` header and emits structured request/latency logs alongside security/webhook audit records.
- **Cloud Run Health Probes**: Configure readiness & liveness HTTP probes against `GET /api/health`.
- **Automated Backups**: Enable daily Firestore backups (`gcloud firestore backups schedules create`) with 30-day retention and configure Cloud Monitoring alerts on HTTP 5xx spikes and Paystack webhook signature failures.
