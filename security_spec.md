# Security Specification — Enterprise Multi-Branch Retail POS

## 1. Data Invariants
1. **Organization & Branch Isolation**: Every organization-owned document carries `organizationId`; every branch-scoped operational record carries `branchId`. A user in Branch A cannot read or mutate records in Branch B unless their active role has organization-wide scope (`scope == 'organization'`) or `branchId in user.branchIds`.
2. **No Self-Assigned Privilege Escalation**: A non-admin user cannot create a `users/{uid}` document with an arbitrary `roleId` or modify their own `roleId`, `branchIds`, `grantedPermissions`, `deniedPermissions`, or `accountStatus`. Self-registration is only allowed by claiming a valid `pending` admin-created `invitations/{id}` matching `request.auth.token.email` (`email_verified == true`).
3. **Immutable Audit & Stock Ledger**: `auditLogs` and `stockMovements` cannot be updated or deleted by any user.
4. **Closed Cash Session Integrity**: Once a `cashSessions/{sessionId}` reaches `status == 'approved'`, it cannot be modified; once `status == 'closed'`, only an authorized `cashSessions.approve` user can transition `status` from `'closed'` to `'approved'`.
5. **Non-Negative Financial & Stock Guards**: Inventory quantities (`quantityAvailable`) cannot drop below `0` unless `organization.allowNegativeInventory == true`. Sale totals and prices cannot be negative.
6. **Temporal Integrity & Path ID Hardening**: All document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and `createdAt`/`updatedAt` timestamps equal `request.time`.

## 2. Adversarial ("Dirty Dozen") Payloads
1. **Cross-Branch Read/Write**: Cashier assigned to `branch_accra` attempts to write a sale with `branchId: 'branch_kumasi'`. -> **PERMISSION_DENIED**
2. **Self Role Escalation on Create**: Newly signed-in user attempts to create `users/{uid}` with `roleId: 'role_super_admin'` without a matching pending invitation. -> **PERMISSION_DENIED**
3. **Self Permission Override on Update**: Cashier updates `users/{uid}` changing `grantedPermissions` or `roleId`. -> **PERMISSION_DENIED**
4. **Unverified Email Bypass**: Unverified auth token (`email_verified: false`) matching bootstrap admin email attempts to write `organizations`. -> **PERMISSION_DENIED**
5. **Shadow Field Injection**: User submits `sales/{saleId}` containing an extra undeclared field `isVerified: true` or `bypassAudit: true`. -> **PERMISSION_DENIED**
6. **Closed Cash Session Tampering**: Cashier edits `actualClosingBalanceMinor` on an already `closed` or `approved` cash session. -> **PERMISSION_DENIED**
7. **Audit Log Deletion / Tampering**: Branch Admin attempts to delete or update an entry in `auditLogs`. -> **PERMISSION_DENIED**
8. **Stock Movement Tampering**: User attempts to modify or delete a historical `stockMovements` record. -> **PERMISSION_DENIED**
9. **Path ID Poisoning**: Attacker writes document with 500-character ID or invalid characters `../admin`. -> **PERMISSION_DENIED**
10. **Negative Price / Quantity Poisoning**: Attacker submits a sale or product with negative `sellingPriceMinor` or negative `totalMinor`. -> **PERMISSION_DENIED**
11. **Suspended Account Mutation**: User with `accountStatus: 'suspended'` attempts to open a cash session or create a sale. -> **PERMISSION_DENIED**
12. **Blanket List Query**: Authenticated user executes unfiltered `list` on `sales` without scoping to their `organizationId` / authorized `branchId`. -> **PERMISSION_DENIED**
