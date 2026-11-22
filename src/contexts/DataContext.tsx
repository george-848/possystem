import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { timestampToDate } from '../lib/money';
import type {
  AppNotification,
  AuditLog,
  BranchDailySummary,
  BranchInventory,
  CashSession,
  Category,
  Customer,
  Expense,
  Invitation,
  Product,
  Purchase,
  Refund,
  Role,
  Sale,
  StockMovement,
  StockTransfer,
  Supplier,
  UserProfile,
} from '../types/pos';
import { useAuth } from './AuthContext';

interface DataContextValue {
  roles: Role[];
  users: UserProfile[];
  invitations: Invitation[];
  categories: Category[];
  products: Product[];
  branchInventory: BranchInventory[];
  stockMovements: StockMovement[];
  sales: Sale[];
  customers: Customer[];
  suppliers: Supplier[];
  purchases: Purchase[];
  stockTransfers: StockTransfer[];
  refunds: Refund[];
  cashSessions: CashSession[];
  expenses: Expense[];
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  dailySummaries: BranchDailySummary[];
  loadingData: boolean;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

function sortByCreatedDesc<T extends { createdAt?: unknown }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => timestampToDate(b.createdAt).getTime() - timestampToDate(a.createdAt).getTime()
  );
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { authReady, userProfile, userRole, isSuperAdmin, hasPermission } = useAuth();

  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchInventory, setBranchInventory] = useState<BranchInventory[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [stockTransfers, setStockTransfers] = useState<StockTransfer[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dailySummaries, setDailySummaries] = useState<BranchDailySummary[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const canViewUsers = hasPermission('users.view');
  const canViewAudit = hasPermission('auditLogs.view');
  const canViewSuppliers = hasPermission('suppliers.view') || hasPermission('purchases.view');
  const canViewPurchases = hasPermission('purchases.view');
  const canViewExpenses = hasPermission('expenses.view');

  useEffect(() => {
    if (!authReady || !userProfile || userProfile.accountStatus !== 'active' || !userRole) {
      setRoles([]);
      setUsers([]);
      setInvitations([]);
      setCategories([]);
      setProducts([]);
      setBranchInventory([]);
      setStockMovements([]);
      setSales([]);
      setCustomers([]);
      setSuppliers([]);
      setPurchases([]);
      setStockTransfers([]);
      setRefunds([]);
      setCashSessions([]);
      setExpenses([]);
      setAuditLogs([]);
      setNotifications([]);
      setDailySummaries([]);
      return;
    }

    setLoadingData(true);
    const orgId = userProfile.organizationId;
    const allowedBranches = new Set(userProfile.branchIds);
    const filterBranch = <T extends { branchId: string }>(rows: T[]) =>
      isSuperAdmin ? rows : rows.filter((r) => allowedBranches.has(r.branchId));

    const unsubs: Array<() => void> = [];
    const safeSub = (
      colName: string,
      onData: (docs: unknown[]) => void,
      maxDocs = 400
    ) => {
      const q = query(
        collection(db, colName),
        where('organizationId', '==', orgId),
        limit(maxDocs)
      );
      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            onData(snap.docs.map((d) => d.data()));
            setLoadingData(false);
          },
          (err) => {
            console.warn(`Listener warning on ${colName}:`, err.message);
            setLoadingData(false);
          }
        )
      );
    };

    safeSub('roles', (d) => setRoles(d as Role[]), 100);
    safeSub('categories', (d) => setCategories(d as Category[]), 200);
    safeSub('products', (d) => setProducts(d as Product[]), 500);
    safeSub('branchInventory', (d) => setBranchInventory(filterBranch(d as BranchInventory[])), 800);
    safeSub('stockMovements', (d) => setStockMovements(sortByCreatedDesc(filterBranch(d as StockMovement[]))), 400);
    safeSub('sales', (d) => setSales(sortByCreatedDesc(filterBranch(d as Sale[]))), 500);
    safeSub('customers', (d) => setCustomers(d as Customer[]), 400);
    safeSub('stockTransfers', (d) => {
      const list = d as StockTransfer[];
      const scoped = isSuperAdmin
        ? list
        : list.filter(
            (t) =>
              allowedBranches.has(t.sourceBranchId) ||
              allowedBranches.has(t.destinationBranchId)
          );
      setStockTransfers(sortByCreatedDesc(scoped));
    }, 300);
    safeSub('refunds', (d) => setRefunds(sortByCreatedDesc(filterBranch(d as Refund[]))), 300);
    safeSub('cashSessions', (d) => {
      const list = filterBranch(d as CashSession[]);
      list.sort((a, b) => timestampToDate(b.openedAt).getTime() - timestampToDate(a.openedAt).getTime());
      setCashSessions(list);
    }, 300);
    safeSub('notifications', (d) => {
      const list = d as AppNotification[];
      const scoped = isSuperAdmin
        ? list
        : list.filter((n) => !n.branchId || allowedBranches.has(n.branchId));
      setNotifications(sortByCreatedDesc(scoped));
    }, 200);
    safeSub('branchDailySummaries', (d) => setDailySummaries(filterBranch(d as BranchDailySummary[])), 400);

    if (canViewUsers) {
      safeSub('users', (d) => setUsers(d as UserProfile[]), 300);
      safeSub('invitations', (d) => setInvitations(sortByCreatedDesc(d as Invitation[])), 200);
    } else {
      setUsers([]);
      setInvitations([]);
    }

    if (canViewSuppliers) {
      safeSub('suppliers', (d) => setSuppliers(d as Supplier[]), 200);
    } else {
      setSuppliers([]);
    }

    if (canViewPurchases) {
      safeSub('purchases', (d) => setPurchases(sortByCreatedDesc(filterBranch(d as Purchase[]))), 300);
    } else {
      setPurchases([]);
    }

    if (canViewExpenses) {
      safeSub('expenses', (d) => setExpenses(sortByCreatedDesc(filterBranch(d as Expense[]))), 300);
    } else {
      setExpenses([]);
    }

    if (canViewAudit) {
      safeSub('auditLogs', (d) => setAuditLogs(sortByCreatedDesc(d as AuditLog[])), 400);
    } else {
      setAuditLogs([]);
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [
    authReady,
    userProfile,
    userRole,
    isSuperAdmin,
    canViewUsers,
    canViewAudit,
    canViewSuppliers,
    canViewPurchases,
    canViewExpenses,
  ]);

  return (
    <DataContext.Provider
      value={{
        roles,
        users,
        invitations,
        categories,
        products,
        branchInventory,
        stockMovements,
        sales,
        customers,
        suppliers,
        purchases,
        stockTransfers,
        refunds,
        cashSessions,
        expenses,
        auditLogs,
        notifications,
        dailySummaries,
        loadingData,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
