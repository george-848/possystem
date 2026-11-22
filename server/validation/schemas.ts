import { z } from 'zod';

export const CheckoutVerifySchema = z.object({
  organizationId: z.string().min(2).max(128),
  branchId: z.string().min(2).max(128),
  defaultTaxRateBps: z.number().int().min(0).max(5000),
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
  filename: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_\-]+$/),
  headers: z.array(z.string().max(120)).min(1).max(40),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(40)).max(5000),
});

export const InvitationEmailSchema = z.object({
  invitationId: z.string().min(2).max(128),
  recipientEmail: z.string().email().max(160),
  recipientName: z.string().min(2).max(160),
  organizationName: z.string().min(1).max(160),
  roleName: z.string().min(1).max(100),
  branchSummary: z.string().min(1).max(300),
  inviteUrl: z.string().url().max(500),
});

