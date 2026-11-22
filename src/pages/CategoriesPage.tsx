import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Archive,
  ArrowRight,
  Boxes,
  Edit3,
  FolderPlus,
  Package,
  RotateCcw,
  Search,
  Tags,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime } from '../lib/money';
import { createCategory, updateCategory } from '../services/catalogService';
import type { Category } from '../types/pos';

const CATEGORY_SWATCHES = [
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-indigo-50 text-indigo-700 border-indigo-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-violet-50 text-violet-700 border-violet-200',
  'bg-rose-50 text-rose-700 border-rose-200',
];

export default function CategoriesPage() {
  const { organization, activeBranchId, hasPermission } = useAuth();
  const { categories, products, branchInventory } = useData();
  const { notify } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const canCreate = hasPermission('products.create');
  const canEdit = hasPermission('products.edit');

  const branchStockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of branchInventory) {
      if (inv.branchId === activeBranchId) {
        map.set(inv.productId, inv.quantityAvailable);
      }
    }
    return map;
  }, [branchInventory, activeBranchId]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { totalProducts: number; activeProducts: number; stockUnits: number }>();
    for (const p of products) {
      const key = p.categoryId || '__uncategorized__';
      const entry = map.get(key) || { totalProducts: 0, activeProducts: 0, stockUnits: 0 };
      entry.totalProducts += 1;
      if (p.status === 'active') entry.activeProducts += 1;
      entry.stockUnits += branchStockByProduct.get(p.productId) || 0;
      map.set(key, entry);
    }
    return map;
  }, [products, branchStockByProduct]);

  const uncategorizedCount = categoryStats.get('__uncategorized__')?.totalProducts || 0;

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categories
      .filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, statusFilter, search]);

  const summary = useMemo(() => {
    const activeCount = categories.filter((c) => c.status === 'active').length;
    const archivedCount = categories.length - activeCount;
    const categorizedProducts = products.filter((p) => Boolean(p.categoryId)).length;
    return {
      total: categories.length,
      activeCount,
      archivedCount,
      categorizedProducts,
    };
  }, [categories, products]);

  const openCreateModal = () => {
    setEditingCategory(null);
    setName('');
    setDescription('');
    setModalOpen(true);
  };

  const openEditModal = (c: Category) => {
    setEditingCategory(c);
    setName(c.name);
    setDescription(c.description || '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !name.trim()) return;
    setSaving(true);
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.categoryId, organization.organizationId, {
          name: name.trim(),
          description: description.trim(),
        });
        notify('success', 'Category Updated', `"${name.trim()}" saved.`);
      } else {
        await createCategory(organization.organizationId, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        notify('success', 'Category Created', `"${name.trim()}" is now available in catalog & POS.`);
      }
      setModalOpen(false);
    } catch (err) {
      notify(
        'error',
        'Save Failed',
        err instanceof Error ? err.message : 'Unable to save category.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (c: Category) => {
    if (!organization) return;
    const nextStatus = c.status === 'active' ? 'archived' : 'active';
    try {
      await updateCategory(c.categoryId, organization.organizationId, { status: nextStatus });
      notify('info', 'Category Status Updated', `"${c.name}" marked ${nextStatus}.`);
    } catch (err) {
      notify(
        'error',
        'Update Failed',
        err instanceof Error ? err.message : 'Unable to update category status.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Product Categories
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Organize your product catalog for rapid POS terminal filtering and branch stock visibility.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/products"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Package className="w-3.5 h-3.5 text-slate-500" />
            View Products
          </Link>
          {canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              New Category
            </button>
          )}
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="bg-white border border-slate-200 rounded-xl p-4"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Total Categories</span>
            <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Tags className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
            {summary.total}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {summary.activeCount} active · {summary.archivedCount} archived
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="bg-white border border-slate-200 rounded-xl p-4"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Categorized SKUs</span>
            <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Package className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
            {summary.categorizedProducts}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {uncategorizedCount} uncategorized product(s)
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="bg-white border border-slate-200 rounded-xl p-4"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Active in POS Tabs</span>
            <span className="w-7 h-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <Boxes className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
            {summary.activeCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Visible in terminal filter bar
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className="bg-white border border-slate-200 rounded-xl p-4"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Catalog Coverage</span>
            <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Tags className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
            {products.length > 0
              ? `${Math.round((summary.categorizedProducts / products.length) * 100)}%`
              : '0%'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {products.length} total catalog items
          </p>
        </motion.div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories by name or description..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'active', 'archived'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'all' ? 'All Categories' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Category Cards Grid */}
      {filteredCategories.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Tags className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {categories.length === 0 ? 'No Product Categories Yet' : 'No Matching Categories'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {categories.length === 0
                ? 'Create categories to group products on the POS terminal and track branch inventory cleanly.'
                : 'Try adjusting your search query or status filter.'}
            </p>
          </div>
          {categories.length === 0 && canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Create First Category
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCategories.map((c, idx) => {
            const stats = categoryStats.get(c.categoryId) || {
              totalProducts: 0,
              activeProducts: 0,
              stockUnits: 0,
            };
            const swatch = CATEGORY_SWATCHES[idx % CATEGORY_SWATCHES.length];
            return (
              <motion.div
                key={c.categoryId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(idx * 0.03, 0.24) }}
                whileHover={{ y: -2 }}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${swatch}`}
                      >
                        <Tags className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 truncate">{c.name}</h3>
                        <p
                          className={`text-[11px] font-medium capitalize ${
                            c.status === 'active' ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {c.status} · Updated {formatDateTime(c.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(c)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                            title="Edit category"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleStatus(c)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                            title={c.status === 'active' ? 'Archive category' : 'Restore category'}
                          >
                            {c.status === 'active' ? (
                              <Archive className="w-3.5 h-3.5" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 mt-3 line-clamp-2 min-h-[2rem]">
                    {c.description || 'No description provided.'}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 text-slate-600 tabular-nums">
                    <span>
                      <strong className="font-mono text-slate-900">{stats.activeProducts}</strong> active SKUs
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong className="font-mono text-slate-900">{stats.stockUnits}</strong> branch units
                    </span>
                  </div>
                  <Link
                    to={`/products?category=${encodeURIComponent(c.categoryId)}`}
                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline whitespace-nowrap"
                  >
                    Products
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Category Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingCategory ? 'Edit Category' : 'New Product Category'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Category Name *
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Beverages, Electronics, Snacks"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Description
              </label>
              <textarea
                rows={3}
                maxLength={300}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional note on products grouped in this category..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingCategory ? 'Save Changes' : 'Create Category'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
