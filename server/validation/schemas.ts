import { z } from 'zod';

const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export const FeatureKeySchema = z.enum([
  'basic_pos',
  'basic_reports',
  'multi_branch',
  'stock_transfers',
  'advanced_inventory',
  'purchasing',
  'warehouse_management',
  'advanced_analytics',
  'audit_logs',
  'advanced_permissions',
  'custom_branding',
  'custom_integrations',
  'advanced_security',
  'priority_support',
]);

export const QuotaResourceSchema = z.enum(['branches', 'terminals', 'staff', 'products']);
export const BillingCycleSchema = z.enum(['monthly', 'annual']);
export const PlanIdSchema = z.string().min(2).max(64).regex(ID_REGEX);

export const CheckoutVerifySchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  branchId: z.string().min(2).max(128).regex(ID_REGEX),
  terminalId: z.string().min(2).max(128).regex(ID_REGEX).optional(),
  defaultTaxRateBps: z.number().int().min(0).max(5000),
  taxIncludedInPrice: z.boolean().optional(),
  orderDiscountMinor: z.number().int().min(0),
  items: z
    .array(
      z.object({
        productId: z.string().min(2).max(128),
        quantity: z.number().int().min(1).max(10000),
        unitPriceMinor: z.number().int().min(0),
        costPriceMinor: z.number().int().min(0),
        discountMinor: z.number().int().min(0),
        taxCategory: z.enum(['standard', 'exempt', 'zero']),
      })
    )
    .min(1)
    .max(200),
  payments: z
    .array(
      z.object({
        method: z.enum(['cash', 'mobile_money', 'card', 'bank_transfer']),
        amountMinor: z.number().int().min(0),
        reference: z.string().max(120).optional(),
      })
    )
    .min(1)
    .max(6),
});

export const CsvExportSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX).optional(),
  filename: z.string().min(1).max(80).regex(ID_REGEX),
  headers: z.array(z.string().max(120)).min(1).max(40),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(40)).max(5000),
});

export const InvitationEmailSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX).optional(),
  invitationId: z.string().min(2).max(128),
  recipientEmail: z.string().email().max(160),
  recipientName: z.string().min(2).max(160),
  organizationName: z.string().min(1).max(160),
  roleName: z.string().min(1).max(100),
  branchSummary: z.string().min(1).max(300),
  inviteUrl: z
    .string()
    .url()
    .max(500)
    .refine(isHttpOrHttpsUrl, 'Invite URL must use http:// or https://.'),
});

export const TenantRegisterSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  registrationNumber: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  country: z.string().trim().min(2).max(80).default('Ghana'),
  currency: z.string().trim().min(3).max(8).default('GHS'),
  currencySymbol: z.string().trim().min(1).max(8).default('GH₵'),
  timezone: z.string().trim().min(2).max(80).default('Africa/Accra'),
  defaultTaxRateBps: z.number().int().min(0).max(5000).default(1500),
  taxLabel: z.string().trim().max(40).optional(),
  branchName: z.string().trim().min(2).max(160),
  branchCity: z.string().trim().max(100).optional(),
  branchRegion: z.string().trim().max(100).optional(),
  branchAddress: z.string().trim().max(300).optional(),
  branchPhone: z.string().trim().max(40).optional(),
  planId: z.enum(['starter', 'professional']).default('starter'),
  seedStarterCategories: z.boolean().default(true),
});

export const EntitlementCheckSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  featureKey: FeatureKeySchema.optional(),
  quotaResource: QuotaResourceSchema.optional(),
  increment: z.number().int().min(1).max(1000).default(1),
});

export const TerminalCreateSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  branchId: z.string().min(2).max(128).regex(ID_REGEX),
  terminalCode: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(120),
  deviceLabel: z.string().trim().max(120).optional(),
});

export const TerminalUpdateSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  name: z.string().trim().min(2).max(120).optional(),
  deviceLabel: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const PaystackCheckoutSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  planId: PlanIdSchema,
  billingCycle: BillingCycleSchema,
  channel: z.enum(['card', 'mobile_money', 'bank_transfer']).default('mobile_money'),
  mobileMoneyNetwork: z.enum(['mtn', 'telecel', 'airteltigo', 'unknown']).optional(),
  callbackUrl: z
    .string()
    .url()
    .max(500)
    .refine(isHttpOrHttpsUrl, 'Callback URL must use http:// or https://.')
    .optional(),
});

export const PaystackVerifySchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  reference: z.string().trim().min(4).max(128),
});

export const PlanChangeSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  targetPlanId: PlanIdSchema,
  targetBillingCycle: BillingCycleSchema,
  immediate: z.boolean().default(false),
});

export const SupportTicketCreateSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  subject: z.string().trim().min(2).max(160),
  category: z.enum(['billing', 'technical', 'entitlements', 'onboarding', 'other']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  message: z.string().trim().min(2).max(2000),
});

export const AdminTenantCreateSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  ownerEmail: z.string().trim().email().max(160),
  ownerName: z.string().trim().min(2).max(160).optional(),
  ownerUid: z.string().trim().min(2).max(128).regex(ID_REGEX).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  country: z.string().trim().min(2).max(80).default('Ghana'),
  currency: z.string().trim().min(3).max(8).default('GHS'),
  currencySymbol: z.string().trim().min(1).max(8).default('GH₵'),
  planId: PlanIdSchema.default('starter'),
  billingCycle: BillingCycleSchema.default('monthly'),
  status: z.enum(['trial', 'active']).default('trial'),
  deploymentMode: z.enum(['shared', 'dedicated']).default('shared'),
});

export const AdminTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().max(300).optional(),
});

export const AdminAssignPlanSchema = z.object({
  planId: PlanIdSchema,
  billingCycle: BillingCycleSchema,
  status: z.enum(['trial', 'active', 'grace_period', 'past_due', 'expired', 'suspended', 'cancelled']),
  periodDays: z.number().int().min(1).max(1095).optional(),
  customLimits: z
    .object({
      maxBranches: z.number().int().min(1).nullable().optional(),
      maxTerminals: z.number().int().min(1).nullable().optional(),
      maxStaff: z.number().int().min(1).nullable().optional(),
      maxProducts: z.number().int().min(1).nullable().optional(),
      fairUseProductCap: z.number().int().min(1).optional(),
    })
    .optional(),
});

export const AdminPlanUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  tagline: z.string().trim().max(160).optional(),
  description: z.string().trim().max(500).optional(),
  monthlyPriceMinor: z.number().int().min(0).optional(),
  annualPriceMinor: z.number().int().min(0).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  gracePeriodDays: z.number().int().min(0).max(60).optional(),
  isCustomPricing: z.boolean().optional(),
  status: z.enum(['active', 'archived']).optional(),
  limits: z
    .object({
      maxBranches: z.number().int().min(1).nullable(),
      maxTerminals: z.number().int().min(1).nullable(),
      maxStaff: z.number().int().min(1).nullable(),
      maxProducts: z.number().int().min(1).nullable(),
      fairUseProductCap: z.number().int().min(1).optional(),
    })
    .optional(),
  features: z.record(FeatureKeySchema, z.boolean()).optional(),
});

export const AdminOverrideCreateSchema = z.object({
  tenantId: z.string().min(2).max(128).regex(ID_REGEX),
  featureKey: FeatureKeySchema.optional(),
  enabled: z.boolean().optional(),
  limitOverrides: z
    .object({
      maxBranches: z.number().int().min(1).nullable().optional(),
      maxTerminals: z.number().int().min(1).nullable().optional(),
      maxStaff: z.number().int().min(1).nullable().optional(),
      maxProducts: z.number().int().min(1).nullable().optional(),
      fairUseProductCap: z.number().int().min(1).optional(),
    })
    .optional(),
  reason: z.string().trim().min(2).max(300),
  durationDays: z.number().int().min(1).max(365).default(14),
});

export const AdminTicketUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});
