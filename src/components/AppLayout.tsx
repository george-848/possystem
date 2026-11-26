import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  Crown,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Package,
  PlusCircle,
  ReceiptText,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useToast } from '../contexts/ToastContext';
import { sanitizeImageSrc } from '../lib/url';
import { ROUTE_FEATURE_REQUIREMENTS } from '../lib/entitlements';
import { formatDateTime, formatMoney } from '../lib/money';
import { markNotificationRead } from '../services/auditService';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string;
  section: string;
  iconIdleClass: string;
  iconActiveClass: string;
  rowActiveClass: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    section: 'Core',
    iconIdleClass: 'bg-emerald-50 text-emerald-600',
    iconActiveClass: 'bg-emerald-600 text-white shadow-xs',
    rowActiveClass: 'bg-emerald-50/90 text-emerald-950 font-semibold',
  },
  {
    to: '/pos',
    label: 'POS Terminal',
    icon: ShoppingCart,
    permission: 'sales.create',
    section: 'Core',
    iconIdleClass: 'bg-teal-50 text-teal-600',
    iconActiveClass: 'bg-teal-600 text-white shadow-xs',
    rowActiveClass: 'bg-teal-50/90 text-teal-950 font-semibold',
  },
  {
    to: '/cash-register',
    label: 'Cash Register',
    icon: Wallet,
    permission: 'cashSessions.view',
    section: 'Core',
    iconIdleClass: 'bg-amber-50 text-amber-600',
    iconActiveClass: 'bg-amber-600 text-white shadow-xs',
    rowActiveClass: 'bg-amber-50/90 text-amber-950 font-semibold',
  },

  {
    to: '/products',
    label: 'Products & Catalog',
    icon: Package,
    permission: 'products.view',
    section: 'Catalog & Stock',
    iconIdleClass: 'bg-indigo-50 text-indigo-600',
    iconActiveClass: 'bg-indigo-600 text-white shadow-xs',
    rowActiveClass: 'bg-indigo-50/90 text-indigo-950 font-semibold',
  },
  {
    to: '/categories',
    label: 'Categories',
    icon: Tags,
    permission: 'products.view',
    section: 'Catalog & Stock',
    iconIdleClass: 'bg-violet-50 text-violet-600',
    iconActiveClass: 'bg-violet-600 text-white shadow-xs',
    rowActiveClass: 'bg-violet-50/90 text-violet-950 font-semibold',
  },
  {
    to: '/inventory',
    label: 'Branch Inventory',
    icon: Boxes,
    permission: 'inventory.view',
    section: 'Catalog & Stock',
    iconIdleClass: 'bg-sky-50 text-sky-600',
    iconActiveClass: 'bg-sky-600 text-white shadow-xs',
    rowActiveClass: 'bg-sky-50/90 text-sky-950 font-semibold',
  },
  {
    to: '/transfers',
    label: 'Stock Transfers',
    icon: ArrowLeftRight,
    permission: 'inventory.transfer',
    section: 'Catalog & Stock',
    iconIdleClass: 'bg-cyan-50 text-cyan-600',
    iconActiveClass: 'bg-cyan-600 text-white shadow-xs',
    rowActiveClass: 'bg-cyan-50/90 text-cyan-950 font-semibold',
  },

  {
    to: '/sales',
    label: 'Sales & Receipts',
    icon: ReceiptText,
    permission: 'sales.view',
    section: 'Transactions',
    iconIdleClass: 'bg-sky-50 text-sky-600',
    iconActiveClass: 'bg-sky-600 text-white shadow-xs',
    rowActiveClass: 'bg-sky-50/90 text-sky-950 font-semibold',
  },
  {
    to: '/refunds',
    label: 'Returns & Refunds',
    icon: RotateCcw,
    permission: 'sales.view',
    section: 'Transactions',
    iconIdleClass: 'bg-rose-50 text-rose-600',
    iconActiveClass: 'bg-rose-600 text-white shadow-xs',
    rowActiveClass: 'bg-rose-50/90 text-rose-950 font-semibold',
  },
  {
    to: '/purchases',
    label: 'Purchases',
    icon: ClipboardList,
    permission: 'purchases.view',
    section: 'Transactions',
    iconIdleClass: 'bg-orange-50 text-orange-600',
    iconActiveClass: 'bg-orange-600 text-white shadow-xs',
    rowActiveClass: 'bg-orange-50/90 text-orange-950 font-semibold',
  },
  {
    to: '/suppliers',
    label: 'Suppliers',
    icon: Truck,
    permission: 'suppliers.view',
    section: 'Transactions',
    iconIdleClass: 'bg-cyan-50 text-cyan-600',
    iconActiveClass: 'bg-cyan-600 text-white shadow-xs',
    rowActiveClass: 'bg-cyan-50/90 text-cyan-950 font-semibold',
  },
  {
    to: '/customers',
    label: 'Customers',
    icon: UserCheck,
    permission: 'customers.view',
    section: 'Transactions',
    iconIdleClass: 'bg-teal-50 text-teal-600',
    iconActiveClass: 'bg-teal-600 text-white shadow-xs',
    rowActiveClass: 'bg-teal-50/90 text-teal-950 font-semibold',
  },
  {
    to: '/expenses',
    label: 'Expenses',
    icon: CreditCard,
    permission: 'expenses.view',
    section: 'Transactions',
    iconIdleClass: 'bg-red-50 text-red-600',
    iconActiveClass: 'bg-red-600 text-white shadow-xs',
    rowActiveClass: 'bg-red-50/90 text-red-950 font-semibold',
  },

  {
    to: '/reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    permission: 'reports.view',
    section: 'Administration',
    iconIdleClass: 'bg-violet-50 text-violet-600',
    iconActiveClass: 'bg-violet-600 text-white shadow-xs',
    rowActiveClass: 'bg-violet-50/90 text-violet-950 font-semibold',
  },
  {
    to: '/branches',
    label: 'Branches',
    icon: Store,
    permission: 'branches.view',
    section: 'Administration',
    iconIdleClass: 'bg-emerald-50 text-emerald-600',
    iconActiveClass: 'bg-emerald-600 text-white shadow-xs',
    rowActiveClass: 'bg-emerald-50/90 text-emerald-950 font-semibold',
  },
  {
    to: '/users',
    label: 'Staff & Access',
    icon: Users,
    permission: 'users.view',
    section: 'Administration',
    iconIdleClass: 'bg-indigo-50 text-indigo-600',
    iconActiveClass: 'bg-indigo-600 text-white shadow-xs',
    rowActiveClass: 'bg-indigo-50/90 text-indigo-950 font-semibold',
  },
  {
    to: '/roles',
    label: 'Roles & Permissions',
    icon: ShieldCheck,
    permission: 'roles.view',
    section: 'Administration',
    iconIdleClass: 'bg-teal-50 text-teal-600',
    iconActiveClass: 'bg-teal-600 text-white shadow-xs',
    rowActiveClass: 'bg-teal-50/90 text-teal-950 font-semibold',
  },
  {
    to: '/audit-logs',
    label: 'Audit Logs',
    icon: FileSpreadsheet,
    permission: 'auditLogs.view',
    section: 'Administration',
    iconIdleClass: 'bg-amber-50 text-amber-600',
    iconActiveClass: 'bg-amber-600 text-white shadow-xs',
    rowActiveClass: 'bg-amber-50/90 text-amber-950 font-semibold',
  },
  {
    to: '/settings',
    label: 'System Settings',
    icon: Settings,
    permission: 'settings.view',
    section: 'Administration',
    iconIdleClass: 'bg-slate-100 text-slate-700',
    iconActiveClass: 'bg-slate-800 text-white shadow-xs',
    rowActiveClass: 'bg-slate-100 text-slate-950 font-semibold',
  },
  {
    to: '/billing',
    label: 'Plan & Billing',
    icon: Crown,
    permission: 'settings.view',
    section: 'Administration',
    iconIdleClass: 'bg-emerald-50 text-emerald-700',
    iconActiveClass: 'bg-emerald-700 text-white shadow-xs',
    rowActiveClass: 'bg-emerald-50/90 text-emerald-950 font-semibold',
  },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    userProfile,
    userRole,
    organization,
    authorizedBranches,
    activeBranchId,
    activeBranch,
    setActiveBranchId,
    hasPermission,
    logout,
  } = useAuth();
  const {
    notifications,
    categories,
    products,
    sales,
    customers,
    suppliers,
    users,
  } = useData();
  const {
    entitlements,
    memberships,
    isPlatformAdmin,
    deploymentMode,
    hasFeature,
    switchTenant,
  } = useEntitlements();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const safeOrgLogo = sanitizeImageSrc(organization?.logoUrl);
  useEffect(() => {
    setLogoError(false);
  }, [organization?.logoUrl]);

  const visibleNavItems = useMemo(() => {
    const base = NAV_ITEMS.filter((item) => hasPermission(item.permission));
    if (isPlatformAdmin) {
      base.push({
        to: '/platform-admin',
        label: 'Platform Super Admin',
        icon: ShieldAlert,
        permission: 'dashboard.view',
        section: 'Platform Owner',
        iconIdleClass: 'bg-slate-900 text-amber-400',
        iconActiveClass: 'bg-slate-900 text-white shadow-xs',
        rowActiveClass: 'bg-slate-900 text-white font-semibold',
      });
    }
    return base;
  }, [hasPermission, isPlatformAdmin]);

  const sections = useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of visibleNavItems) {
      const list = map.get(item.section) || [];
      list.push(item);
      map.set(item.section, list);
    }
    return Array.from(map.entries());
  }, [visibleNavItems]);

  const unreadCount = useMemo(() => {
    if (!userProfile) return 0;
    return notifications.filter((n) => !n.readBy?.includes(userProfile.uid)).length;
  }, [notifications, userProfile]);

  const globalSearchResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (q.length < 2) return [];
    const results: Array<{ id: string; type: string; title: string; subtitle: string; to: string }> = [];

    for (const c of categories) {
      if (c.name.toLowerCase().includes(q)) {
        results.push({
          id: c.categoryId,
          type: 'Category',
          title: c.name,
          subtitle: c.status === 'active' ? 'Active product category' : 'Archived category',
          to: '/categories',
        });
      }
      if (results.length >= 6) break;
    }

    for (const p of products) {
      if (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      ) {
        results.push({
          id: p.productId,
          type: 'Product',
          title: p.name,
          subtitle: `SKU ${p.sku} · ${formatMoney(p.sellingPriceMinor, organization?.currencySymbol)}`,
          to: '/products',
        });
      }
      if (results.length >= 12) break;
    }

    for (const s of sales) {
      if (s.transactionNumber.toLowerCase().includes(q)) {
        results.push({
          id: s.saleId,
          type: 'Sale',
          title: s.transactionNumber,
          subtitle: `${formatMoney(s.totalMinor, organization?.currencySymbol)} · ${s.saleStatus}`,
          to: '/sales',
        });
      }
      if (results.length >= 16) break;
    }

    for (const c of customers) {
      if (
        c.fullName.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q))
      ) {
        results.push({
          id: c.customerId,
          type: 'Customer',
          title: c.fullName,
          subtitle: c.phone || c.email || 'Registered Customer',
          to: '/customers',
        });
      }
      if (results.length >= 20) break;
    }

    for (const sup of suppliers) {
      if (sup.name.toLowerCase().includes(q)) {
        results.push({
          id: sup.supplierId,
          type: 'Supplier',
          title: sup.name,
          subtitle: sup.contactPerson || sup.phone || 'Supplier',
          to: '/suppliers',
        });
      }
    }

    for (const u of users) {
      if (u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) {
        results.push({
          id: u.uid,
          type: 'Staff',
          title: u.fullName,
          subtitle: u.email,
          to: '/users',
        });
      }
    }

    for (const b of authorizedBranches) {
      if (
        b.branchName.toLowerCase().includes(q) ||
        b.branchCode.toLowerCase().includes(q)
      ) {
        results.push({
          id: b.branchId,
          type: 'Branch',
          title: `${b.branchName} (${b.branchCode})`,
          subtitle: b.city || b.status,
          to: '/branches',
        });
      }
    }

    return results.slice(0, 10);
  }, [searchTerm, categories, products, sales, customers, suppliers, users, authorizedBranches, organization]);

  const currentPageLabel =
    visibleNavItems.find((i) => location.pathname.startsWith(i.to))?.label || 'Workspace';

  const handleBranchSwitch = async (nextBranchId: string) => {
    try {
      await setActiveBranchId(nextBranchId);
      const target = authorizedBranches.find((b) => b.branchId === nextBranchId);
      notify('info', 'Active Branch Switched', `Now operating in ${target?.branchName || nextBranchId}`);
    } catch (err) {
      notify('error', 'Branch Switch Rejected', err instanceof Error ? err.message : 'Unauthorized');
    }
  };

  const handleTenantSwitch = async (nextTenantId: string) => {
    if (!nextTenantId || nextTenantId === organization?.organizationId) return;
    setSwitchingTenant(true);
    try {
      await switchTenant(nextTenantId);
      notify('info', 'Business Workspace Switched', 'Reloading tenant data and entitlements...');
    } catch (err) {
      notify('error', 'Switch Failed', err instanceof Error ? err.message : 'Unable to switch business.');
    } finally {
      setSwitchingTenant(false);
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-64">
      <div className="px-4 py-3.5 border-b border-slate-200 shrink-0 space-y-2.5">
        <div className="flex items-center gap-3">
          {safeOrgLogo && !logoError ? (
            <div className="w-9 h-9 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
              <img
                src={safeOrgLogo}
                alt={organization?.businessName || 'Organization Logo'}
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="w-full h-full object-contain p-0.5"
              />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Building2 className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 truncate font-display">
              {organization?.businessName || 'Multi-Branch POS System'}
            </p>
            <p className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
              <span>{userRole?.name || 'Retail Operations'}</span>
              {entitlements && (
                <span className="font-mono text-emerald-700 font-semibold">
                  · {entitlements.plan.name}
                </span>
              )}
            </p>
          </div>
        </div>

        {(memberships.length > 1 || deploymentMode === 'shared') && (
          <div className="flex items-center gap-1.5">
            {memberships.length > 1 && (
              <select
                aria-label="Switch Business Workspace"
                disabled={switchingTenant}
                value={organization?.organizationId || ''}
                onChange={(e) => void handleTenantSwitch(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md text-slate-700 truncate"
              >
                {memberships.map((m) => (
                  <option key={m.membershipId} value={m.tenantId}>
                    {m.tenantId === organization?.organizationId
                      ? organization.businessName
                      : m.tenantId}
                  </option>
                ))}
              </select>
            )}
            {deploymentMode === 'shared' && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate('/setup');
                }}
                title="Register another retail business"
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md shrink-0"
              >
                <PlusCircle className="w-3 h-3" />
                {memberships.length <= 1 ? 'New Business' : 'Add'}
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map(([sectionName, items]) => (
          <div key={sectionName}>
            <p className="px-3 mb-1.5 text-[11px] font-semibold text-slate-400 tracking-wide">
              {sectionName}
            </p>
            <div className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon;
                const reqFeature = ROUTE_FEATURE_REQUIREMENTS[item.to];
                const isLocked = Boolean(reqFeature && !hasFeature(reqFeature));
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? item.rowActiveClass
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                            isActive ? item.iconActiveClass : item.iconIdleClass
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                        </span>
                        <span className="truncate flex-1">{item.label}</span>
                        {isLocked && (
                          <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-2 shrink-0">
        <div className="px-2 py-1.5">
          <p className="text-xs font-semibold text-slate-900 truncate">
            {userProfile?.fullName}
          </p>
          <p className="text-[11px] text-slate-500 truncate">{userProfile?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
        >
          <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 transition-colors group-hover:bg-rose-600 group-hover:text-white">
            <LogOut className="w-4 h-4" />
          </span>
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A]">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:block shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-900 truncate">
                {currentPageLabel}
              </h1>
              <p className="text-xs text-slate-500 truncate hidden sm:block">
                {activeBranch
                  ? `${activeBranch.branchName} · ${activeBranch.branchCode}`
                  : 'Select Branch'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Global Search */}
            <div className="relative hidden md:block w-64 lg:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                placeholder="Search SKU, receipt, customer..."
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
              {searchFocused && globalSearchResults.length > 0 && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {globalSearchResults.map((res) => (
                    <button
                      key={`${res.type}_${res.id}`}
                      type="button"
                      onMouseDown={() => {
                        setSearchTerm('');
                        navigate(res.to);
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {res.title}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{res.subtitle}</p>
                      </div>
                      <span className="text-[11px] font-medium text-slate-500 shrink-0">
                        {res.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Active Branch Selector */}
            {authorizedBranches.length > 0 && (
              <select
                aria-label="Active Branch"
                value={activeBranchId}
                onChange={(e) => void handleBranchSwitch(e.target.value)}
                className="px-3 py-1.5 text-sm font-medium bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-emerald-600 max-w-[190px] truncate"
              >
                {authorizedBranches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchCode} — {b.branchName}
                  </option>
                ))}
              </select>
            )}

            {/* Notification Centre */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                aria-label="Open notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">
                      Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-slate-400 hover:text-slate-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No alerts recorded yet.
                      </div>
                    ) : (
                      notifications.slice(0, 20).map((n) => {
                        const isRead = userProfile ? n.readBy?.includes(userProfile.uid) : true;
                        return (
                          <div
                            key={n.notificationId}
                            className={`p-3.5 text-left ${isRead ? 'bg-white' : 'bg-emerald-50/40'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                              {!isRead && userProfile && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void markNotificationRead(n.notificationId, userProfile.uid)
                                  }
                                  className="text-[11px] font-medium text-emerald-700 hover:underline shrink-0"
                                >
                                  Mark read
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                            <p className="text-[11px] text-slate-400 mt-1.5 font-mono">
                              {formatDateTime(n.createdAt)}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {entitlements &&
          (!entitlements.isOperational ||
            entitlements.effectiveStatus === 'grace_period' ||
            (entitlements.effectiveStatus === 'trial' &&
              entitlements.daysRemaining !== null &&
              entitlements.daysRemaining <= 7)) && (
            <div
              className={`no-print px-4 lg:px-6 py-2.5 border-b text-xs flex flex-wrap items-center justify-between gap-2 ${
                !entitlements.isOperational
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : entitlements.effectiveStatus === 'grace_period'
                    ? 'bg-amber-50 border-amber-200 text-amber-950'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-950'
              }`}
            >
              <p className="font-medium">
                {!entitlements.isOperational
                  ? entitlements.blockingReason || 'Subscription is inactive. Renew to restore POS writes.'
                  : entitlements.effectiveStatus === 'grace_period'
                    ? `Payment grace period active (${entitlements.graceDaysRemaining ?? 0} day(s) left before lockout).`
                    : `${entitlements.plan.name} trial: ${entitlements.daysRemaining ?? 0} day(s) remaining.`}
              </p>
              <NavLink
                to="/billing"
                className="font-semibold underline underline-offset-2 shrink-0"
              >
                Manage Plan &amp; Billing →
              </NavLink>
            </div>
          )}

        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
