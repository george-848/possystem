/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { ToastProvider } from './contexts/ToastContext';

import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { OrganizationSetupPage } from './pages/OrganizationSetupPage';
import { DashboardPage } from './pages/DashboardPage';
import { PosTerminalPage } from './pages/PosTerminalPage';
import { CashRegisterPage } from './pages/CashRegisterPage';
import { ProductsPage } from './pages/ProductsPage';
import CategoriesPage from './pages/CategoriesPage';
import { InventoryPage } from './pages/InventoryPage';
import { SalesPage } from './pages/SalesPage';
import { RefundsPage } from './pages/RefundsPage';
import PurchasesPage from './pages/PurchasesPage';
import SuppliersPage from './pages/SuppliersPage';
import CustomersPage from './pages/CustomersPage';
import TransfersPage from './pages/TransfersPage';
import ExpensesPage from './pages/ExpensesPage';
import ReportsPage from './pages/ReportsPage';
import BranchesPage from './pages/BranchesPage';
import UsersPage from './pages/UsersPage';
import RolesPermissionsPage from './pages/RolesPermissionsPage';
import AuditLogsPage from './pages/AuditLogsPage';
import SettingsPage from './pages/SettingsPage';

function PermissionRoute({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-lg mx-auto mt-10 text-center">
        <ShieldAlert className="w-10 h-10 text-rose-600 mx-auto mb-3" />
        <h2 className="text-base font-bold text-slate-900">Access Restricted</h2>
        <p className="text-sm text-slate-600 mt-1">
          Your role or permission overrides do not grant access to this module (
          <code className="font-mono text-xs">{permission}</code>).
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  const {
    authReady,
    loadingProfile,
    firebaseUser,
    userProfile,
    userRole,
    needsOrgSetup,
  } = useAuth();

  if (!authReady || (firebaseUser && loadingProfile)) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 text-sm font-medium text-slate-700">
          Verifying session and branch access policies...
        </div>
      </div>
    );
  }

  // Unauthenticated routes
  if (!firebaseUser) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // First Super Admin organization bootstrap
  if (needsOrgSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<OrganizationSetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  // Invited / Uninvited / Suspended / Inactive role guard
  if (!userProfile || userProfile.accountStatus !== 'active' || !userRole) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Active authenticated workspace
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <PermissionRoute permission="dashboard.view">
              <DashboardPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/pos"
          element={
            <PermissionRoute permission="sales.create">
              <PosTerminalPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/cash-register"
          element={
            <PermissionRoute permission="cashSessions.view">
              <CashRegisterPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/products"
          element={
            <PermissionRoute permission="products.view">
              <ProductsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/categories"
          element={
            <PermissionRoute permission="products.view">
              <CategoriesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/inventory"
          element={
            <PermissionRoute permission="inventory.view">
              <InventoryPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/transfers"
          element={
            <PermissionRoute permission="inventory.transfer">
              <TransfersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/sales"
          element={
            <PermissionRoute permission="sales.view">
              <SalesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/refunds"
          element={
            <PermissionRoute permission="sales.view">
              <RefundsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/purchases"
          element={
            <PermissionRoute permission="purchases.view">
              <PurchasesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/suppliers"
          element={
            <PermissionRoute permission="suppliers.view">
              <SuppliersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <PermissionRoute permission="customers.view">
              <CustomersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/expenses"
          element={
            <PermissionRoute permission="expenses.view">
              <ExpensesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <PermissionRoute permission="reports.view">
              <ReportsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/branches"
          element={
            <PermissionRoute permission="branches.view">
              <BranchesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/users"
          element={
            <PermissionRoute permission="users.view">
              <UsersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/roles"
          element={
            <PermissionRoute permission="roles.view">
              <RolesPermissionsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <PermissionRoute permission="auditLogs.view">
              <AuditLogsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PermissionRoute permission="settings.view">
              <SettingsPage />
            </PermissionRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </MotionConfig>
  );
}
