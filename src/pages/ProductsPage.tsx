import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Archive,
  Edit3,
  FolderPlus,
  Package,
  Plus,
  Search,
  Tags,
  Upload,
  X,
} from 'lucide-react';
import { ProductImportModal } from '../components/ProductImportModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { isProductAssignedToBranch } from '../lib/barcode';
import { formatMoney, fromMinorUnits, toMinorUnits } from '../lib/money';
import {
  createCategory,
  createProduct,
  updateProduct,
} from '../services/catalogService';
import type { Product, TaxCategory } from '../types/pos';

export function ProductsPage() {
  const { organization, branches, activeBranchId, hasPermission } = useAuth();
  const { products, categories, branchInventory } = useData();
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get('category') || 'all';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [catFilter, setCatFilter] = useState(categoryParam);
  const [branchFilter, setBranchFilter] = useState<string>(activeBranchId || 'all');

  useEffect(() => {
    setCatFilter(categoryParam);
  }, [categoryParam]);

  useEffect(() => {
    if (activeBranchId) {
      setBranchFilter(activeBranchId);
    }
  }, [activeBranchId]);

  const [showProductModal, setShowProductModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');

  // Form states
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [costStr, setCostStr] = useState('');
  const [sellStr, setSellStr] = useState('');
  const [wholesaleStr, setWholesaleStr] = useState('');
  const [taxCategory, setTaxCategory] = useState<TaxCategory>('standard');
  const [minimumStock, setMinimumStock] = useState('5');
  const [initialQty, setInitialQty] = useState('0');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [availableBranchIds, setAvailableBranchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const sym = organization?.currencySymbol || 'GH₵';
  const canCreate = hasPermission('products.create');
  const canEdit = hasPermission('products.edit');
  const canArchive = hasPermission('products.delete');
  const canAdjustStock = hasPermission('inventory.adjust');

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.categoryId, c.name])),
    [categories]
  );

  const branchCodeMap = useMemo(
    () => new Map(branches.map((b) => [b.branchId, b.branchCode])),
    [branches]
  );

  const branchNameMap = useMemo(
    () => new Map(branches.map((b) => [b.branchId, `${b.branchCode} — ${b.branchName}`])),
    [branches]
  );

  const stockBranchId = branchFilter === 'all' ? activeBranchId : branchFilter;

  const stockInBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of branchInventory) {
      if (i.branchId === stockBranchId) map.set(i.productId, i.quantityAvailable);
    }
    return map;
  }, [branchInventory, stockBranchId]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (catFilter !== 'all' && p.categoryId !== catFilter) return false;
      if (branchFilter !== 'all' && !isProductAssignedToBranch(p, branchFilter)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q))
      );
    });
  }, [products, statusFilter, catFilter, branchFilter, search]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setSku('');
    setBarcode('');
    setCategoryId(categories[0]?.categoryId || '');
    setBrand('');
    setUnit('pcs');
    setCostStr('');
    setSellStr('');
    setWholesaleStr('');
    setTaxCategory('standard');
    setMinimumStock('5');
    setInitialQty('0');
    setImageUrl('');
    setDescription('');
    const defaultBranchId =
      (branchFilter !== 'all' ? branchFilter : activeBranchId) || branches[0]?.branchId || '';
    setAvailableBranchIds(defaultBranchId ? [defaultBranchId] : []);
    setShowProductModal(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setSku(p.sku);
    setBarcode(p.barcode || '');
    setCategoryId(p.categoryId || '');
    setBrand(p.brand || '');
    setUnit(p.unit || 'pcs');
    setCostStr(fromMinorUnits(p.costPriceMinor).toFixed(2));
    setSellStr(fromMinorUnits(p.sellingPriceMinor).toFixed(2));
    setWholesaleStr(
      p.wholesalePriceMinor !== undefined
        ? fromMinorUnits(p.wholesalePriceMinor).toFixed(2)
        : ''
    );
    setTaxCategory(p.taxCategory);
    setMinimumStock(String(p.minimumStock));
    setImageUrl(p.imageUrl || '');
    setDescription(p.description || '');
    setAvailableBranchIds(p.availableBranchIds || branches.map((b) => b.branchId));
    setShowProductModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    if (availableBranchIds.length === 0) {
      notify('error', 'Select Branch', 'Select at least one branch where this product should appear.');
      return;
    }
    setSaving(true);
    try {
      const costPriceMinor = toMinorUnits(costStr);
      const sellingPriceMinor = toMinorUnits(sellStr);
      const wholesalePriceMinor = wholesaleStr ? toMinorUnits(wholesaleStr) : undefined;
      const minStk = Math.max(0, Number.parseInt(minimumStock || '0', 10));

      if (editingProduct) {
        const priceChanged =
          costPriceMinor !== editingProduct.costPriceMinor ||
          sellingPriceMinor !== editingProduct.sellingPriceMinor;
        await updateProduct(
          editingProduct.productId,
          organization.organizationId,
          {
            categoryId: categoryId || undefined,
            name: name.trim(),
            sku: sku.trim().toUpperCase(),
            barcode: barcode.trim() || undefined,
            brand: brand.trim() || undefined,
            unit: unit.trim() || 'pcs',
            imageUrl: imageUrl.trim() || undefined,
            description: description.trim() || undefined,
            costPriceMinor,
            sellingPriceMinor,
            wholesalePriceMinor,
            taxCategory,
            minimumStock: minStk,
            availableBranchIds,
          },
          priceChanged
        );
        notify('success', 'Product Updated', `${name} saved.`);
      } else {
        const targetInitialBranchId = availableBranchIds.includes(activeBranchId)
          ? activeBranchId
          : availableBranchIds[0];

        await createProduct(organization.organizationId, {
          categoryId: categoryId || undefined,
          name,
          sku,
          barcode,
          brand,
          unit,
          imageUrl,
          description,
          costPriceMinor,
          sellingPriceMinor,
          wholesalePriceMinor,
          taxCategory,
          minimumStock: minStk,
          availableBranchIds,
          initialBranchId: targetInitialBranchId,
          initialQuantity: Math.max(0, Number.parseInt(initialQty || '0', 10)),
        });
        notify('success', 'Product Created', `${name} added to catalog.`);
      }
      if (branchFilter !== 'all' && !availableBranchIds.includes(branchFilter)) {
        setBranchFilter(availableBranchIds[0]);
      }
      setShowProductModal(false);
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save product.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async (p: Product) => {
    if (!organization) return;
    const nextStatus = p.status === 'active' ? 'archived' : 'active';
    try {
      await updateProduct(p.productId, organization.organizationId, { status: nextStatus });
      notify('info', 'Product Status Updated', `${p.name} marked ${nextStatus}.`);
    } catch (err) {
      notify('error', 'Error', err instanceof Error ? err.message : 'Action failed');
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !catName.trim()) return;
    try {
      await createCategory(organization.organizationId, { name: catName, description: catDesc });
      setCatName('');
      setCatDesc('');
      setShowCatModal(false);
      notify('success', 'Category Added', `${catName} is now available.`);
    } catch (err) {
      notify('error', 'Error', err instanceof Error ? err.message : 'Failed to create category');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display">
            Central Product Catalog
          </h2>
          <p className="text-xs text-slate-500">
            Manage master SKUs, pricing, tax categories, and branch availability
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/categories"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Tags className="w-3.5 h-3.5 text-emerald-600" />
            All Categories ({categories.length})
          </Link>
          {canCreate && (
            <>
              <button
                type="button"
                onClick={() => setShowCatModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                Add Category
              </button>
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-600" />
                Import Excel / CSV
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
              >
                <Plus className="w-3.5 h-3.5" />
                New Product
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, SKU, barcode, brand..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Branches</option>
          {branches.map((b) => (
            <option key={b.branchId} value={b.branchId}>
              {b.branchCode} — {b.branchName}
            </option>
          ))}
        </select>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'active' | 'archived' | 'all')}
          className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="active">Active Only</option>
          <option value="archived">Archived</option>
          <option value="all">All Products</option>
        </select>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Product</th>
                <th className="text-left px-5 py-3 font-medium">SKU / Barcode</th>
                <th className="text-left px-5 py-3 font-medium">Category</th>
                <th className="text-left px-5 py-3 font-medium">Branches</th>
                <th className="text-right px-5 py-3 font-medium">Cost</th>
                <th className="text-right px-5 py-3 font-medium">Selling</th>
                <th className="text-right px-5 py-3 font-medium">Branch Stock</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((p) => {
                const branchLabels = !p.availableBranchIds
                  ? 'All Branches'
                  : p.availableBranchIds.length === 0
                    ? 'Unassigned'
                    : p.availableBranchIds.map((id) => branchCodeMap.get(id) || id).join(', ');
                return (
                <tr key={p.productId} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-900">{p.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {p.brand || 'Generic'} · {p.unit || 'pcs'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-700">
                    <div>{p.sku}</div>
                    {p.barcode && <div className="text-[11px] text-slate-400">{p.barcode}</div>}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {(p.categoryId && categoryMap.get(p.categoryId)) || 'Uncategorized'}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {branchLabels}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-600">
                    {formatMoney(p.costPriceMinor, sym)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums font-semibold text-slate-900">
                    {formatMoney(p.sellingPriceMinor, sym)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                    {stockInBranch.get(p.productId) ?? 0}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize">
                    <span
                      className={
                        p.status === 'active'
                          ? 'text-emerald-700 font-medium'
                          : 'text-slate-400'
                      }
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                          title="Edit Product"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canArchive && (
                        <button
                          type="button"
                          onClick={() => void handleArchiveToggle(p)}
                          className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                          title={p.status === 'active' ? 'Archive Product' : 'Restore Product'}
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-xs text-slate-500">
                    No products found for this branch filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleSaveProduct(e)}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {editingProduct ? 'Edit Product' : 'Register New Product'}
              </h3>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">SKU *</label>
                <input
                  type="text"
                  required
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  placeholder="SKU-001"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Barcode</label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">Uncategorized</option>
                  {categories
                    .filter((c) => c.status === 'active')
                    .map((c) => (
                      <option key={c.categoryId} value={c.categoryId}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Brand</label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cost Price ({sym}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={costStr}
                  onChange={(e) => setCostStr(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Selling Price ({sym}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={sellStr}
                  onChange={(e) => setSellStr(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Wholesale Price ({sym})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={wholesaleStr}
                  onChange={(e) => setWholesaleStr(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tax Category
                </label>
                <select
                  value={taxCategory}
                  onChange={(e) => setTaxCategory(e.target.value as TaxCategory)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="standard">Standard Tax</option>
                  <option value="exempt">Tax Exempt</option>
                  <option value="zero">Zero-Rated</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Unit</label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="pcs, box, kg"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Minimum Reorder Level
                </label>
                <input
                  type="number"
                  min="0"
                  value={minimumStock}
                  onChange={(e) => setMinimumStock(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              {!editingProduct && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Initial Stock (
                    {branchNameMap.get(
                      availableBranchIds.includes(activeBranchId)
                        ? activeBranchId
                        : availableBranchIds[0] || ''
                    ) || 'Selected Branch'}
                    )
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={initialQty}
                    onChange={(e) => setInitialQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Product Image URL (Optional)
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Branch Availability *
                  </label>
                  <div className="flex items-center gap-2 text-[11px]">
                    {activeBranchId && (
                      <button
                        type="button"
                        onClick={() => setAvailableBranchIds([activeBranchId])}
                        className="text-emerald-700 hover:underline font-medium"
                      >
                        Active Branch Only
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAvailableBranchIds(branches.map((b) => b.branchId))}
                      className="text-slate-600 hover:underline"
                    >
                      All Branches
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {branches.map((b) => (
                    <label key={b.branchId} className="inline-flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={availableBranchIds.includes(b.branchId)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAvailableBranchIds((prev) => [...prev, b.branchId]);
                          } else {
                            setAvailableBranchIds((prev) =>
                              prev.filter((id) => id !== b.branchId)
                            );
                          }
                        }}
                      />
                      {b.branchCode} — {b.branchName}
                    </label>
                  ))}
                </div>
                {availableBranchIds.length === 0 && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    Select at least one branch where this product should appear.
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || availableBranchIds.length === 0}
                className="px-5 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Create Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Category Modal */}
      {showCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleCreateCategory(e)}
            className="bg-white border border-slate-200 rounded-xl max-w-sm w-full p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">New Product Category</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <input
                type="text"
                value={catDesc}
                onChange={(e) => setCatDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCatModal(false)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg"
              >
                Save Category
              </button>
            </div>
          </form>
        </div>
      )}

      {organization && (
        <ProductImportModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          organizationId={organization.organizationId}
          currencySymbol={sym}
          branches={branches}
          activeBranchId={activeBranchId}
          products={products}
          categories={categories}
          canEditProducts={canEdit}
          canAdjustStock={canAdjustStock}
          onImported={(importedBranches) => {
            if (
              branchFilter !== 'all' &&
              importedBranches.length > 0 &&
              !importedBranches.includes(branchFilter)
            ) {
              setBranchFilter(importedBranches[0]);
            }
          }}
        />
      )}
    </div>
  );
}
