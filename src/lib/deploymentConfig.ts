/**
 * Deployment topology helpers supporting:
 * 1. Shared Multi-Tenant SaaS Cloud Run deployment (`DEPLOYMENT_MODE=shared`)
 * 2. Dedicated Enterprise Single-Tenant Cloud Run + isolated Firebase/Firestore deployment
 *    (`DEPLOYMENT_MODE=dedicated`, `DEDICATED_TENANT_ID=org_...`)
 */

export type DeploymentTopologyMode = 'shared' | 'dedicated';

export interface ClientDeploymentInfo {
  mode: DeploymentTopologyMode;
  dedicatedTenantId: string | null;
  appBrandingName: string;
}

export function getClientDeploymentInfo(): ClientDeploymentInfo {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const rawMode = env?.VITE_DEPLOYMENT_MODE?.trim().toLowerCase();
  const mode: DeploymentTopologyMode = rawMode === 'dedicated' ? 'dedicated' : 'shared';
  const dedicatedTenantId = env?.VITE_DEDICATED_TENANT_ID?.trim() || null;
  const appBrandingName = env?.VITE_APP_BRAND_NAME?.trim() || 'Multi-Branch POS System';

  return {
    mode,
    dedicatedTenantId: mode === 'dedicated' ? dedicatedTenantId : null,
    appBrandingName,
  };
}

export function isTenantPermittedInTopology(
  tenantId: string,
  mode: DeploymentTopologyMode,
  dedicatedTenantId: string | null
): boolean {
  if (mode !== 'dedicated' || !dedicatedTenantId) {
    return true;
  }
  return tenantId === dedicatedTenantId;
}
