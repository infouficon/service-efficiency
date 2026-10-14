import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag,
  Plus,
  Edit2,
  Tag,
  Smartphone,
  Tablet,
  Laptop,
  Watch,
  Box,
  Check,
  X,
  ArrowLeft,
  Search,
  Package,
  Boxes,
  Building2,
  AlertCircle,
  Save,
  Headphones,
} from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { StockUnlimitedBanner } from '../admin/StockUnlimitedPanel';
import { api } from '../../services/api';
import { fetchCategoriesApi } from '../../services/sessionApi';
import type { Category, MockUser } from '../../types/session';
import type { ManagedBranch } from '../../types/accounts';

export interface BranchInventoryItem {
  id: string;
  branchId: string;
  skuId: string;
  stock: number;
  active: boolean;
  branch?: { id: string; code: string; name: string };
  /** Warroom (ERP) numbers for this branch and SKU; null or absent = no ERP data, the manual `stock` applies. */
  erpReady?: number | null;
  erpTransfer?: number | null;
  /** ISO time of the warroom snapshot behind erpReady and erpTransfer. */
  erpAsOf?: string | null;
  /** erpReady minus the units SES has already promised; null when erpReady is null. */
  available?: number | null;
}

export interface SkuItem {
  id: string;
  sku: string;
  name: string;
  color?: string | null;
  storage?: string | null;
  /** barcode from warroom (D72), next to the part number in `sku` */
  upc?: string | null;
  active: boolean;
  /** Created and kept in sync from the ERP: only `active` can be changed here. */
  erpManaged?: boolean;
  inventory?: BranchInventoryItem[];
}

export interface ModelItem {
  id: string;
  name: string;
  active: boolean;
  erpManaged?: boolean;
  skus: SkuItem[];
}

export interface ProductItem {
  id: string;
  /** the name of a category (D72) */
  category: string;
  name: string;
  active: boolean;
  erpManaged?: boolean;
  models: ModelItem[];
}

/** Does this branch row carry ERP numbers? */
const hasErpStock = (inv: BranchInventoryItem) => typeof inv.erpReady === 'number';

/** Badge on a product, model or SKU the ERP sync created and owns. */
function ErpBadge() {
  return (
    <span className="erp-badge" title="รายการนี้ซิงก์จาก ERP (warroom)">
      ERP
    </span>
  );
}

/** "พร้อมขาย 12 · โอน 3 · คงเหลือสุทธิ 10 · ณ 12 ต.ค. 12:31": the ERP numbers of a branch row; nothing for a row without ERP data. */
function ErpStockLine({ inv }: { inv: BranchInventoryItem }) {
  if (typeof inv.erpReady !== 'number') return null;
  const asOf = inv.erpAsOf ? new Date(inv.erpAsOf) : null;
  const parts = [
    `พร้อมขาย ${inv.erpReady}`,
    `โอน ${inv.erpTransfer ?? '—'}`,
    `คงเหลือสุทธิ ${inv.available ?? inv.erpReady}`,
  ];
  if (asOf && !Number.isNaN(asOf.getTime())) {
    parts.push(
      `ณ ${asOf.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    );
  }
  return <div className="erp-stock-line">{parts.join(' · ')}</div>;
}

interface ProductWorkspaceProps {
  user: MockUser;
  subView?: 'MAIN' | 'STOCK';
  onSubViewChange?: (view: 'MAIN' | 'STOCK') => void;
}

/** `ALL`, or the name of a category (D72) */
type CategoryTab = string;

export function ProductWorkspace({ user, subView, onSubViewChange }: ProductWorkspaceProps) {
  const toast = useToast();
  const isAdmin = user.roles.includes('ADMIN');

  // Navigation & View state
  const [internalViewMode, setInternalViewMode] = useState<'MAIN' | 'STOCK'>('MAIN');
  const viewMode = subView !== undefined ? subView : internalViewMode;

  const handleSetViewMode = (mode: 'MAIN' | 'STOCK') => {
    if (onSubViewChange) {
      onSubViewChange(mode);
    }
    setInternalViewMode(mode);
  };

  const [selectedProductId, setSelectedProductId] = useState<string | 'ALL'>('ALL');

  // Data state
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [branches, setBranches] = useState<ManagedBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('ALL');
  // D72: the categories ADMIN keeps (a manager reads the active ones); the five Apple lines until they load
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');

  // Branch Stock Breakdown Modal
  const [breakdownModal, setBreakdownModal] = useState<{
    open: boolean;
    sku: SkuItem | null;
    productName: string;
    modelName: string;
    stockInputs: Record<string, number>;
  }>({
    open: false,
    sku: null,
    productName: '',
    modelName: '',
    stockInputs: {},
  });

  // Discard Confirmation Modal State (D44)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Compute branches with modified stock that have not been saved (D44)
  const unsavedBranches = useMemo(() => {
    if (!breakdownModal.open || !breakdownModal.sku || !breakdownModal.sku.inventory) return [];
    return breakdownModal.sku.inventory.filter((inv) => {
      const inputVal = breakdownModal.stockInputs[inv.branchId];
      return inputVal !== undefined && inputVal !== inv.stock;
    });
  }, [breakdownModal]);

  const hasUnsavedChanges = unsavedBranches.length > 0;

  // Intercept closing breakdown modal when there are unsaved edits (D44)
  const handleRequestCloseBreakdown = () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      setBreakdownModal((prev) => ({ ...prev, open: false }));
    }
  };

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    setBreakdownModal((prev) => ({ ...prev, open: false }));
  };

  const handleCancelDiscard = () => {
    setShowDiscardConfirm(false);
  };

  // Product Edit / Create Modal
  const [productModal, setProductModal] = useState<{
    open: boolean;
    editingId?: string;
    category: string;
    name: string;
    active: boolean;
  }>({
    open: false,
    category: 'iPhone',
    name: '',
    active: true,
  });

  // Model Modal
  const [modelModal, setModelModal] = useState<{
    open: boolean;
    productId?: string;
    editingId?: string;
    name: string;
    active: boolean;
  }>({
    open: false,
    name: '',
    active: true,
  });

  // SKU Modal
  const [skuModal, setSkuModal] = useState<{
    open: boolean;
    modelId?: string;
    editingId?: string;
    sku: string;
    name: string;
    color: string;
    storage: string;
    active: boolean;
  }>({
    open: false,
    sku: '',
    name: '',
    color: '',
    storage: '',
    active: true,
  });

  // Records the ERP sync owns (erpManaged): their names, codes, colour, storage and category are read-only here, only `active` stays editable.
  const erpManagedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of products) {
      if (p.erpManaged) ids.add(p.id);
      for (const m of p.models || []) {
        if (m.erpManaged) ids.add(m.id);
        for (const s of m.skus || []) {
          if (s.erpManaged) ids.add(s.id);
        }
      }
    }
    return ids;
  }, [products]);
  const isErpManaged = (id?: string) => id !== undefined && erpManagedIds.has(id);
  const productLocked = isErpManaged(productModal.editingId);
  const modelLocked = isErpManaged(modelModal.editingId);
  const skuLocked = isErpManaged(skuModal.editingId);

  const loadData = useCallback(async () => {
    try {
      const [prods, brs] = await Promise.all([
        api<ProductItem[]>('/products?admin=true'),
        isAdmin ? api<ManagedBranch[]>('/branches') : Promise.resolve([]),
      ]);
      setProducts(prods);
      if (isAdmin && brs) {
        setBranches(brs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลสินค้าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<ProductItem[]>('/products?admin=true'),
      isAdmin ? api<ManagedBranch[]>('/branches') : Promise.resolve([]),
    ])
      .then(([prods, brs]) => {
        if (active) {
          setProducts(prods);
          if (brs) setBranches(brs);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'โหลดข้อมูลสินค้าไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    let active = true;
    fetchCategoriesApi(isAdmin)
      .then((list) => {
        if (active) setCategories(list);
      })
      .catch(() => {
        // the tabs and the category select then show only the categories of the loaded products
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  // While the warroom sync mode is `on`, branch stock that has ERP numbers comes from the ERP and the manual input is locked.
  // Only ADMIN can read the mode (a MANAGER would get 403 and has no stock input anyway); without it nothing is locked.
  const [erpStockLocked, setErpStockLocked] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api<{ mode: string }>('/admin/warroom-sync/status')
      .then((sync) => {
        if (active) setErpStockLocked(sync.mode === 'on');
      })
      .catch(() => {
        // Status unavailable: keep the manual stock editable; the API still refuses a row it has locked.
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);
  // The number staff see for a branch row: the ERP's net availability while the mode is `on` (when the row has it), else the manual stock.
  const effectiveStock = (inv: BranchInventoryItem) =>
    erpStockLocked && typeof inv.available === 'number' ? inv.available : inv.stock;

  // Handle Branch Stock update in breakdown modal
  const handleSaveBranchStock = async (branchId: string, skuId: string) => {
    const qty = breakdownModal.stockInputs[branchId] ?? 0;
    setBusy(true);
    try {
      await api(`/products/branches/${branchId}/skus/${skuId}/stock`, 'PUT', {
        stock: Number(qty),
      });
      toast.success('อัปเดตจำนวนสต็อกเรียบร้อย');
      await loadData();
      // Update local breakdown modal
      setBreakdownModal((prev) => {
        if (!prev.sku) return prev;
        const updatedInv = (prev.sku.inventory || []).map((inv) =>
          inv.branchId === branchId ? { ...inv, stock: Number(qty) } : inv,
        );
        return {
          ...prev,
          sku: { ...prev.sku, inventory: updatedInv },
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ปรับปรุงสต็อกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Handle Save All modified branch stocks (D44)
  const handleSaveAllBranchStock = async () => {
    if (!breakdownModal.sku || unsavedBranches.length === 0) return;
    setBusy(true);
    try {
      const promises = unsavedBranches.map((inv) => {
        const qty = breakdownModal.stockInputs[inv.branchId] ?? inv.stock;
        return api(`/products/branches/${inv.branchId}/skus/${breakdownModal.sku!.id}/stock`, 'PUT', {
          stock: Number(qty),
        });
      });
      await Promise.all(promises);
      toast.success(`อัปเดตสต็อก ${unsavedBranches.length} สาขาเรียบร้อย`);
      await loadData();
      // Update local breakdown modal
      setBreakdownModal((prev) => {
        if (!prev.sku) return prev;
        const updatedInv = (prev.sku.inventory || []).map((inv) => {
          const inputVal = prev.stockInputs[inv.branchId];
          return inputVal !== undefined ? { ...inv, stock: Number(inputVal) } : inv;
        });
        return {
          ...prev,
          sku: { ...prev.sku, inventory: updatedInv },
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ปรับปรุงสต็อกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Handle Branch Active Toggle
  const handleToggleBranchActive = async (branchId: string, skuId: string, currentActive: boolean) => {
    setBusy(true);
    try {
      await api(`/products/branches/${branchId}/skus/${skuId}/active`, 'PUT', {
        active: !currentActive,
      });
      toast.success(`${!currentActive ? 'เปิด' : 'ปิด'}การขายในสาขาเรียบร้อย`);
      await loadData();
      // Update local breakdown modal
      setBreakdownModal((prev) => {
        if (!prev.sku) return prev;
        const updatedInv = (prev.sku.inventory || []).map((inv) =>
          inv.branchId === branchId ? { ...inv, active: !currentActive } : inv,
        );
        return {
          ...prev,
          sku: { ...prev.sku, inventory: updatedInv },
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Handle Save Master Product
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (productModal.editingId) {
        await api(`/products/${productModal.editingId}`, 'PUT', {
          // The ERP owns category and name of an ERP-managed product: send only what may change.
          ...(productLocked ? {} : { category: productModal.category, name: productModal.name }),
          active: productModal.active,
        });
        toast.success('อัปเดตข้อมูลสินค้าเรียบร้อย (ระบบอัปเดตสถานะสาขาที่เกี่ยวข้องอัตโนมัติ)');
      } else {
        await api('/products', 'POST', {
          category: productModal.category,
          name: productModal.name,
        });
        toast.success('เพิ่มสินค้าใหม่เรียบร้อย');
      }
      setProductModal({ open: false, category: 'iPhone', name: '', active: true });
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกสินค้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Handle Save Model
  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (modelModal.editingId) {
        await api(`/products/models/${modelModal.editingId}`, 'PUT', {
          ...(modelLocked ? {} : { name: modelModal.name }),
          active: modelModal.active,
        });
        toast.success('อัปเดตรุ่นสินค้าเรียบร้อย');
      } else if (modelModal.productId) {
        await api(`/products/${modelModal.productId}/models`, 'POST', {
          name: modelModal.name,
        });
        toast.success('เพิ่มรุ่นสินค้าใหม่เรียบร้อย');
      }
      setModelModal({ open: false, name: '', active: true });
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกรุ่นสินค้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Handle Save SKU
  const handleSaveSku = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (skuModal.editingId) {
        await api(`/products/skus/${skuModal.editingId}`, 'PUT', {
          ...(skuLocked
            ? {}
            : {
                sku: skuModal.sku,
                name: skuModal.name,
                color: skuModal.color || undefined,
                storage: skuModal.storage || undefined,
              }),
          active: skuModal.active,
        });
        toast.success('อัปเดต SKU เรียบร้อย');
      } else if (skuModal.modelId) {
        await api(`/products/models/${skuModal.modelId}/skus`, 'POST', {
          sku: skuModal.sku,
          name: skuModal.name,
          color: skuModal.color || undefined,
          storage: skuModal.storage || undefined,
        });
        toast.success('เพิ่ม SKU ใหม่เรียบร้อย');
      }
      setSkuModal({ open: false, sku: '', name: '', color: '', storage: '', active: true });
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึก SKU ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Helper icons
  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'iPhone':
        return <Smartphone size={15} />;
      case 'iPad':
        return <Tablet size={15} />;
      case 'Mac':
        return <Laptop size={15} />;
      case 'Watch':
        return <Watch size={15} />;
      case 'Accessories':
        return <Headphones size={15} />;
      default:
        return <Box size={15} />;
    }
  };

  // The tabs: every active category, plus a switched-off one that still has products (so the back office can find them).
  const tabCategories = useMemo(() => {
    const names = categories
      .filter((c) => c.active || (c.productCount ?? 0) > 0)
      .map((c) => c.name);
    for (const p of products) if (!names.includes(p.category)) names.push(p.category);
    return names;
  }, [categories, products]);
  const activeCategoryNames = useMemo(
    () => categories.filter((c) => c.active).map((c) => c.name),
    [categories],
  );
  // The category select of the product form: the active categories, plus the one the product being edited already has.
  const categoryChoices = useMemo(
    () =>
      activeCategoryNames.includes(productModal.category) || !productModal.category
        ? activeCategoryNames
        : [...activeCategoryNames, productModal.category],
    [activeCategoryNames, productModal.category],
  );

  // Filter products by category and search
  const filteredProducts = products.filter((p) => {
    if (categoryTab !== 'ALL' && p.category !== categoryTab) return false;
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    const matchProd = p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query);
    const matchModel = p.models?.some((m) =>
      m.name.toLowerCase().includes(query) ||
      m.skus?.some((s) => s.sku.toLowerCase().includes(query) || s.name.toLowerCase().includes(query)),
    );
    return matchProd || matchModel;
  });

  // Flat list of SKUs for Stock View
  const allSkusForStockView: Array<{
    sku: SkuItem;
    product: ProductItem;
    model: ModelItem;
  }> = [];

  for (const p of products) {
    if (selectedProductId !== 'ALL' && p.id !== selectedProductId) continue;
    if (categoryTab !== 'ALL' && p.category !== categoryTab) continue;
    for (const m of p.models || []) {
      for (const s of m.skus || []) {
        if (search.trim()) {
          const query = search.toLowerCase();
          const match =
            s.sku.toLowerCase().includes(query) ||
            (s.upc ?? '').toLowerCase().includes(query) ||
            s.name.toLowerCase().includes(query) ||
            p.name.toLowerCase().includes(query) ||
            m.name.toLowerCase().includes(query);
          if (!match) continue;
        }
        allSkusForStockView.push({
          sku: s,
          product: p,
          model: m,
        });
      }
    }
  }

  const selectedProductObj = products.find((p) => p.id === selectedProductId);

  return (
    <div className="product-workspace">
      {/* Header Bar */}
      <div className="workspace-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {viewMode === 'STOCK' ? (
            <Package size={24} color="#0abab5" />
          ) : (
            <ShoppingBag size={24} color="#0abab5" />
          )}
          <div>
            <h2 style={{ margin: 0 }}>
              {viewMode === 'STOCK'
                ? `Stock สินค้า${selectedProductObj ? `: ${selectedProductObj.name}` : ''}`
                : 'จัดการสินค้า'}
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {viewMode === 'STOCK'
                ? 'ตรวจสอบจำนวนสต็อกคงเหลือและสถานะเปิด/ปิดการขายของแต่ละสาขา'
                : `ระบบจัดการสินค้าและสต็อกรายสาขา · ผู้ใช้งาน: ${user.name || user.staffId}`}
            </p>
          </div>
        </div>

        {viewMode === 'MAIN' && isAdmin && (
          <Button
            onClick={() =>
              setProductModal({
                open: true,
                category: categoryTab !== 'ALL' ? categoryTab : (activeCategoryNames[0] ?? 'iPhone'),
                name: '',
                active: true,
              })
            }
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} />
              เพิ่มสินค้าหลัก
            </span>
          </Button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice error>{error}</Notice>
        </div>
      )}

      <StockUnlimitedBanner />

      {/* Filter & Search Bar */}
      <div
        className="product-filter-bar"
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="category-tabs" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {['ALL', ...tabCategories].map((cat) => (
              <button
                key={cat}
                className={`tab-btn ${categoryTab === cat ? 'active' : ''}`}
                onClick={() => setCategoryTab(cat)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {getCategoryIcon(cat)}
                {cat === 'ALL' ? 'ทั้งหมด' : cat}
                {cat !== 'ALL' && categories.some((c) => c.name === cat && !c.active) && (
                  <span className="muted fine">(ปิด)</span>
                )}
              </button>
            ))}
          </div>

          <div className="product-search-input-wrap" style={{ position: 'relative' }}>
            <input
              type="search"
              placeholder={viewMode === 'STOCK' ? 'ค้นหา SKU, รุ่น หรือชื่อสินค้า...' : 'ค้นหาชื่อสินค้า, รุ่น หรือ SKU...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '28px' }}
            />
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>

        {viewMode === 'STOCK' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>
              เลือกสินค้า:
            </span>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontWeight: 500,
              }}
            >
              <option value="ALL">สินค้าทั้งหมด (All Products)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* VIEW MODE 1: MAIN UNIFIED PRODUCT TABLE */}
      {viewMode === 'MAIN' && (
        <>
          {loading ? (
            <Notice>กำลังโหลดรายการสินค้า…</Notice>
          ) : filteredProducts.length === 0 ? (
            <Panel title="ไม่พบรายการสินค้า">
              <p className="muted">ยังไม่มีสินค้าในหมวดหมู่นี้ หรือไม่ตรงกับคำค้นหา</p>
            </Panel>
          ) : (
            <div className="table-responsive" style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color, #e2e8f0)', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '36%' }}>Product</th>
                    <th style={{ width: '16%' }}>LOB</th>
                    <th style={{ width: '16%' }}>Status</th>
                    <th style={{ width: '16%', textAlign: 'center' }}>Inventory</th>
                    <th style={{ width: '16%', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((prod) => {
                    // Aggregate stats for this product
                    let totalStock = 0;
                    let totalSkus = 0;
                    for (const m of prod.models || []) {
                      for (const s of m.skus || []) {
                        totalSkus += 1;
                        for (const inv of s.inventory || []) {
                          totalStock += effectiveStock(inv) || 0;
                        }
                      }
                    }

                    return (
                      <tr key={prod.id}>
                        <td>
                          <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{prod.name}</strong>
                          {prod.erpManaged && <ErpBadge />}
                          <div className="fine muted" style={{ marginTop: '2px' }}>
                            {prod.models?.length || 0} รุ่นย่อย
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              backgroundColor: 'var(--panel-sub-bg, #f1f5f9)',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                            }}
                          >
                            {getCategoryIcon(prod.category)}
                            {prod.category}
                          </span>
                        </td>
                        <td>
                          <span className={`status-tag ${prod.active ? 'status-found' : 'status-outcome'}`}>
                            {prod.active ? '● ใช้งาน' : '○ ปิดใช้งาน'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' , textAlign: 'center'}}>
                            <strong style={{ color: totalStock > 0 ? '#047857' : '#b91c1c', fontSize: '0.9rem' }}>
                              {totalStock}
                            </strong>
                            <span className="fine muted">{totalSkus} SKUs</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                            {isAdmin && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  setProductModal({
                                    open: true,
                                    editingId: prod.id,
                                    category: prod.category,
                                    name: prod.name,
                                    active: prod.active,
                                  })
                                }
                              >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <Edit2 size={13} />
                                  แก้ไข
                                </span>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedProductId(prod.id);
                                handleSetViewMode('STOCK');
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Package size={13} />
                                Stock
                              </span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* VIEW MODE 2: STOCK VIEW */}
      {viewMode === 'STOCK' && (
        <>
          {loading ? (
            <Notice>กำลังโหลดข้อมูล Stock สินค้า…</Notice>
          ) : allSkusForStockView.length === 0 ? (
            <Panel title="ไม่พบรายการ Stock สินค้า">
              <p className="muted">ไม่มี SKU ตรงกับเงื่อนไขที่เลือก</p>
            </Panel>
          ) : (
            <div className="table-responsive" style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color, #e2e8f0)', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>SKU</th>
                    <th style={{ width: '33%' }}>Product</th>
                    <th style={{ width: '18%' }}>Branches</th>
                    <th style={{ width: '15%' }}>Available</th>
                    <th style={{ width: '12%', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allSkusForStockView.map(({ sku, product, model }) => {
                    const invList = sku.inventory || [];
                    const branchesWithStock = invList.filter((inv) => effectiveStock(inv) > 0).length;
                    const totalBranchesCount = branches.length > 0 ? branches.length : (invList.length || 1);
                    const totalStock = invList.reduce((sum, inv) => sum + (effectiveStock(inv) || 0), 0);
                    const isAvailable = totalStock > 0;

                    return (
                      <tr
                        key={sku.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          const initialInputs: Record<string, number> = {};
                          for (const inv of invList) {
                            initialInputs[inv.branchId] = inv.stock;
                          }
                          setBreakdownModal({
                            open: true,
                            sku,
                            productName: product.name,
                            modelName: model.name,
                            stockInputs: initialInputs,
                          });
                        }}
                      >
                        <td>
                          <strong style={{ color: '#0f172a' }}>{sku.sku}</strong>
                          {sku.erpManaged && <ErpBadge />}
                          {sku.upc && <div className="fine muted">UPC {sku.upc}</div>}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {product.name} · {model.name}
                          </div>
                          <div className="fine muted">
                            {sku.name} {[sku.storage, sku.color].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              backgroundColor: branchesWithStock > 0 ? '#ecfdf5' : '#f1f5f9',
                              color: branchesWithStock > 0 ? '#047857' : '#64748b',
                              fontWeight: 600,
                              fontSize: '0.85rem',
                            }}
                          >
                            <Building2 size={13} />
                            {branchesWithStock}/{totalBranchesCount} สาขา
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ color: isAvailable ? '#047857' : '#b91c1c' }}>
                              {totalStock} 
                            </strong>
                            <span className={`status-tag ${isAvailable ? 'status-found' : 'status-outcome'}`} style={{ fontSize: '0.75rem', padding: '1px 6px' }}>
                              {isAvailable ? 'พร้อมจำหน่าย' : 'สินค้าหมด'}
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              const initialInputs: Record<string, number> = {};
                              for (const inv of invList) {
                                initialInputs[inv.branchId] = inv.stock;
                              }
                              setBreakdownModal({
                                open: true,
                                sku,
                                productName: product.name,
                                modelName: model.name,
                                stockInputs: initialInputs,
                              });
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Package size={13} />
                              ดูสต็อกสาขา
                            </span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* MODAL 1: BRANCH STOCK BREAKDOWN MODAL */}
      {breakdownModal.open && breakdownModal.sku && (
        <Modal
          title={`สต็อกรายสาขา — ${breakdownModal.sku.sku}`}
          isOpen={breakdownModal.open}
          onClose={handleRequestCloseBreakdown}
          maxWidth={breakdownModal.sku.inventory?.some(hasErpStock) ? '720px' : undefined}
        >
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '1rem', color: '#0f172a' }}>
              {breakdownModal.productName} · {breakdownModal.modelName}
            </div>
            <div className="fine muted">
              ตัวเลือก: {breakdownModal.sku.name} · รหัส SKU: {breakdownModal.sku.sku}
            </div>
          </div>

          <div className="table-responsive" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>สาขา (Branch)</th>
                  <th style={{ width: '120px' }}>สถานะในสาขา</th>
                  <th style={{ width: '160px' }}>สต็อกคงเหลือ (ชิ้น)</th>
                </tr>
              </thead>
              <tbody>
                {breakdownModal.sku.inventory?.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: 'center' }}>
                      ยังไม่มีข้อมูลสต็อกของสาขา
                    </td>
                  </tr>
                ) : (
                  breakdownModal.sku.inventory?.map((inv) => {
                    const currentQty =
                      breakdownModal.stockInputs[inv.branchId] !== undefined
                        ? breakdownModal.stockInputs[inv.branchId]
                        : inv.stock;
                    // Mode `on`: the ERP number is the stock of this row, so the manual input is locked and shows it instead.
                    const stockLocked = erpStockLocked && hasErpStock(inv);

                    return (
                      <tr key={inv.id}>
                        <td>
                          <strong>{inv.branch?.code || 'สาขา'}</strong>
                          <div className="fine muted">{inv.branch?.name || ''}</div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`status-tag ${inv.active ? 'status-found' : 'status-outcome'}`}
                            style={{ cursor: 'pointer', border: 'none', padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600 }}
                            title="คลิกเพื่อสลับเปิด/ปิดสถานะการขายในสาขานี้"
                            onClick={() =>
                              handleToggleBranchActive(inv.branchId, breakdownModal.sku!.id, inv.active)
                            }
                          >
                            {inv.active ? '● เปิด' : '○ ปิด'}
                          </button>
                        </td>
                        <td
                          className={stockLocked ? 'erp-managed-form' : undefined}
                          title={stockLocked ? 'สต็อกสาขานี้มาจาก ERP' : undefined}
                        >
                          {isAdmin ? (
                            <input
                              type="number"
                              min="0"
                              value={stockLocked ? effectiveStock(inv) : currentQty}
                              disabled={stockLocked}
                              onChange={(e) => {
                                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                setBreakdownModal((prev) => ({
                                  ...prev,
                                  stockInputs: {
                                    ...prev.stockInputs,
                                    [inv.branchId]: val,
                                  },
                                }));
                              }}
                              style={{
                                width: '90px',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #cbd5e1)',
                                fontWeight: 600,
                              }}
                            />
                          ) : (
                            <strong style={{ color: inv.stock > 0 ? '#047857' : '#b91c1c' }}>
                              {inv.stock} ชิ้น
                            </strong>
                          )}
                          <ErpStockLine inv={inv} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '1rem' }}>
            <div>
              {hasUnsavedChanges && (
                <span style={{ fontSize: '0.85rem', color: '#d97706', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <AlertCircle size={14} /> มีการแก้ไข {unsavedBranches.length} สาขาที่ยังไม่ได้บันทึก
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {isAdmin && hasUnsavedChanges && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveAllBranchStock}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Save size={14} />
                    บันทึก
                  </span>
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* CONFIRMATION MODAL: DISCARD UNSAVED STOCK CHANGES (D44) */}
      {showDiscardConfirm && (
        <Modal
          title="ยืนยันการละทิ้งการแก้ไข"
          isOpen={showDiscardConfirm}
          onClose={handleCancelDiscard}
          maxWidth="460px"
        >
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ color: '#d97706', marginTop: '2px', flexShrink: 0 }}>
                <AlertCircle size={26} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#0f172a', marginBottom: '4px' }}>
                  มีการแก้ไขสต็อกที่ยังไม่ได้บันทึก
                </div>
                <p style={{ margin: 0, color: '#475569', fontSize: '0.875rem', lineHeight: '1.5' }}>
                  คุณมีการเปลี่ยนแปลงจำนวนสต็อก {unsavedBranches.length} สาขาที่ยังไม่ได้บันทึก ต้องการละทิ้งการเปลี่ยนแปลงหรือไม่?
                </p>
              </div>
            </div>
          </div>
          <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
            <Button
              variant="secondary"
              type="button"
              onClick={handleConfirmDiscard}
              style={{ color: '#b91c1c', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
            >
              ละทิ้งและปิด
            </Button>
            <Button
              type="button"
              onClick={handleCancelDiscard}
            >
              กลับไปแก้ไข
            </Button>
          </div>
        </Modal>
      )}

      {/* MODAL 2: PRODUCT EDIT & MODEL/SKU MANAGEMENT MODAL */}
      {productModal.open && (
        <Modal
          title={productModal.editingId ? 'แก้ไขข้อมูลสินค้าหลัก' : 'เพิ่มสินค้าหลัก'}
          isOpen={productModal.open}
          onClose={() => setProductModal({ ...productModal, open: false })}
        >
          <form onSubmit={handleSaveProduct} className={productLocked ? 'erp-managed-form' : undefined}>
            {productLocked && (
              <Notice>สินค้านี้มาจาก ERP (warroom) ชื่อและหมวดหมู่ต้องแก้ที่ ERP ที่นี่ทำได้เพียงเปิด/ปิดการใช้งาน</Notice>
            )}
            <label>
              หมวดหมู่สินค้า (LOB / Category)
              <select
                disabled={productLocked}
                value={productModal.category}
                onChange={(e) =>
                  setProductModal({
                    ...productModal,
                    category: e.target.value,
                  })
                }
              >
                {categoryChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ชื่อสินค้าหลัก (Product Name)
              <input
                required
                disabled={productLocked}
                placeholder="เช่น iPhone 16 Pro, iPad Pro 11-inch"
                value={productModal.name}
                onChange={(e) =>
                  setProductModal({ ...productModal, name: e.target.value })
                }
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={productModal.active}
                onChange={(e) =>
                  setProductModal({
                    ...productModal,
                    active: e.target.checked,
                  })
                }
              />
              <span>เปิดใช้งานสินค้านี้ (หากปิด ทุกรุ่นย่อยและทุกสาขาจะถูกปิดอัตโนมัติ)</span>
            </label>

            {/* If editing existing product, show list of models to add/edit */}
            {productModal.editingId && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>รุ่นและ SKU ภายใต้สินค้านี้</strong>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() =>
                      setModelModal({
                        open: true,
                        productId: productModal.editingId,
                        name: '',
                        active: true,
                      })
                    }
                  >
                    <Plus size={13} /> เพิ่มรุ่น (Model)
                  </Button>
                </div>

                {products
                  .find((p) => p.id === productModal.editingId)
                  ?.models?.map((model) => (
                    <div
                      key={model.id}
                      style={{
                        padding: '8px 12px',
                        background: '#f8fafc',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Tag size={14} color="#0abab5" style={{ display: 'inline', marginRight: '6px' }} />
                          <strong>{model.name}</strong>
                          {model.erpManaged && <ErpBadge />}
                          <span className={`status-tag ${model.active ? 'status-found' : 'status-outcome'}`} style={{ marginLeft: '8px', fontSize: '0.75rem' }}>
                            {model.active ? 'ใช้งาน' : 'ปิด'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            type="button"
                            onClick={() =>
                              setModelModal({
                                open: true,
                                editingId: model.id,
                                name: model.name,
                                active: model.active,
                              })
                            }
                          >
                            แก้ไขรุ่น
                          </Button>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() =>
                              setSkuModal({
                                open: true,
                                modelId: model.id,
                                sku: '',
                                name: '',
                                color: '',
                                storage: '',
                                active: true,
                              })
                            }
                          >
                            + SKU
                          </Button>
                        </div>
                      </div>

                      {model.skus?.length > 0 && (
                        <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#475569' }}>
                          {model.skus.map((s) => (
                            <span
                              key={s.id}
                              style={{
                                display: 'inline-block',
                                marginRight: '6px',
                                marginBottom: '4px',
                                padding: '2px 6px',
                                background: '#fff',
                                borderRadius: '4px',
                                border: '1px solid #cbd5e1',
                              }}
                            >
                              {s.sku} ({s.name})
                              {s.erpManaged && <ErpBadge />}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}

            <div className="actions" style={{ marginTop: '1.5rem' }}>
              <Button type="submit" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกสินค้า'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setProductModal({ ...productModal, open: false })}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 3: MODEL MODAL */}
      {modelModal.open && (
        <Modal
          title={modelModal.editingId ? 'แก้ไขรุ่นสินค้า (Model)' : 'เพิ่มรุ่นสินค้าใหม่ (Model)'}
          isOpen={modelModal.open}
          onClose={() => setModelModal({ ...modelModal, open: false })}
        >
          <form onSubmit={handleSaveModel} className={modelLocked ? 'erp-managed-form' : undefined}>
            {modelLocked && (
              <Notice>รุ่นนี้มาจาก ERP (warroom) ชื่อรุ่นต้องแก้ที่ ERP ที่นี่ทำได้เพียงเปิด/ปิดการใช้งาน</Notice>
            )}
            <label>
              ชื่อรุ่นสินค้า (Model Name)
              <input
                required
                disabled={modelLocked}
                placeholder="เช่น iPhone 16 Pro, Wi-Fi + Cellular"
                value={modelModal.name}
                onChange={(e) =>
                  setModelModal({ ...modelModal, name: e.target.value })
                }
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={modelModal.active}
                onChange={(e) =>
                  setModelModal({
                    ...modelModal,
                    active: e.target.checked,
                  })
                }
              />
              <span>เปิดใช้งานรุ่นนี้ (หากปิด ทุก SKU ย่อยและทุกสาขาจะถูกปิดอัตโนมัติ)</span>
            </label>
            <div className="actions" style={{ marginTop: '1.5rem' }}>
              <Button type="submit" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกรุ่นสินค้า'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setModelModal({ ...modelModal, open: false })}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 4: SKU MODAL */}
      {skuModal.open && (
        <Modal
          title={skuModal.editingId ? 'แก้ไข SKU' : 'เพิ่ม SKU ใหม่'}
          isOpen={skuModal.open}
          onClose={() => setSkuModal({ ...skuModal, open: false })}
        >
          <form onSubmit={handleSaveSku} className={skuLocked ? 'erp-managed-form' : undefined}>
            {skuLocked && (
              <Notice>SKU นี้มาจาก ERP (warroom) รหัส ชื่อ ความจุ และสีต้องแก้ที่ ERP ที่นี่ทำได้เพียงเปิด/ปิดการใช้งาน</Notice>
            )}
            <label>
              รหัส SKU (SKU Code)
              <input
                required
                disabled={skuLocked}
                placeholder="เช่น IP16P-256-NAT"
                value={skuModal.sku}
                onChange={(e) =>
                  setSkuModal({ ...skuModal, sku: e.target.value })
                }
              />
            </label>
            <label>
              ชื่อรายการตัวเลือก (Display Name)
              <input
                required
                disabled={skuLocked}
                placeholder="เช่น 256GB Natural Titanium"
                value={skuModal.name}
                onChange={(e) =>
                  setSkuModal({ ...skuModal, name: e.target.value })
                }
              />
            </label>
            <div className="form-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <label>
                ความจุ (Storage)
                <input
                  disabled={skuLocked}
                  placeholder="เช่น 128GB, 256GB"
                  value={skuModal.storage}
                  onChange={(e) =>
                    setSkuModal({ ...skuModal, storage: e.target.value })
                  }
                />
              </label>
              <label>
                สี (Color)
                <input
                  disabled={skuLocked}
                  placeholder="เช่น Natural Titanium"
                  value={skuModal.color}
                  onChange={(e) =>
                    setSkuModal({ ...skuModal, color: e.target.value })
                  }
                />
              </label>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={skuModal.active}
                onChange={(e) =>
                  setSkuModal({
                    ...skuModal,
                    active: e.target.checked,
                  })
                }
              />
              <span>เปิดใช้งาน SKU นี้ (หากปิด ทุกสาขาจะถูกปิดอัตโนมัติ)</span>
            </label>
            <div className="actions" style={{ marginTop: '1.5rem' }}>
              <Button type="submit" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึก SKU'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setSkuModal({ ...skuModal, open: false })}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
