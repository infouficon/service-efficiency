import { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import type { MockUser } from '../../types/session';

export interface SkuItem {
  id: string;
  sku: string;
  name: string;
  color?: string | null;
  storage?: string | null;
  active: boolean;
}

export interface ModelItem {
  id: string;
  name: string;
  active: boolean;
  skus: SkuItem[];
}

export interface ProductItem {
  id: string;
  category: 'iPhone' | 'iPad' | 'Mac' | 'Watch';
  name: string;
  active: boolean;
  models: ModelItem[];
}

interface ProductWorkspaceProps {
  user: MockUser;
}

type CategoryTab = 'ALL' | 'iPhone' | 'iPad' | 'Mac' | 'Watch';

export function ProductWorkspace({ user }: ProductWorkspaceProps) {
  const toast = useToast();
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('ALL');
  const [search, setSearch] = useState('');

  // Modals state
  const [productModal, setProductModal] = useState<{
    open: boolean;
    editingId?: string;
    category: 'iPhone' | 'iPad' | 'Mac' | 'Watch';
    name: string;
    active: boolean;
  }>({
    open: false,
    category: 'iPhone',
    name: '',
    active: true,
  });

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

  const loadProducts = useCallback(async () => {
    try {
      const data = await api<ProductItem[]>('/products?admin=true');
      setProducts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายการสินค้าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api<ProductItem[]>('/products?admin=true')
      .then((data) => {
        if (active) {
          setProducts(data);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'โหลดรายการสินค้าไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (productModal.editingId) {
        await api(`/products/${productModal.editingId}`, 'PUT', {
          category: productModal.category,
          name: productModal.name,
          active: productModal.active,
        });
        toast.success('อัปเดตข้อมูลสินค้าเรียบร้อย');
      } else {
        await api('/products', 'POST', {
          category: productModal.category,
          name: productModal.name,
        });
        toast.success('เพิ่มสินค้าใหม่เรียบร้อย');
      }
      setProductModal({ open: false, category: 'iPhone', name: '', active: true });
      await loadProducts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'บันทึกสินค้าไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (modelModal.editingId) {
        await api(`/products/models/${modelModal.editingId}`, 'PUT', {
          name: modelModal.name,
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
      await loadProducts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'บันทึกรุ่นสินค้าไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSku = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (skuModal.editingId) {
        await api(`/products/skus/${skuModal.editingId}`, 'PUT', {
          sku: skuModal.sku,
          name: skuModal.name,
          color: skuModal.color || undefined,
          storage: skuModal.storage || undefined,
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
      await loadProducts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'บันทึก SKU ไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

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

  const getCategoryTabIcon = (cat: CategoryTab) => {
    switch (cat) {
      case 'iPhone':
        return <Smartphone size={15} />;
      case 'iPad':
        return <Tablet size={15} />;
      case 'Mac':
        return <Laptop size={15} />;
      case 'Watch':
        return <Watch size={15} />;
      default:
        return <Box size={15} />;
    }
  };

  return (
    <div className="product-workspace">
      <div className="workspace-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShoppingBag size={24} color="#0abab5" />
          <div>
            <h2 style={{ margin: 0 }}>จัดการสินค้า</h2>
            <p className="muted" style={{ margin: 0 }}>
              จัดการรายการหมวดหมู่, รุ่น (Models), และ SKU สินค้าสำหรับทุกสาขา · ผู้ดูแล: {user.name || user.staffId}
            </p>
          </div>
        </div>
        <div>
          <Button
            onClick={() =>
              setProductModal({
                open: true,
                category: categoryTab !== 'ALL' ? categoryTab : 'iPhone',
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
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice error>{error}</Notice>
        </div>
      )}

      <div className="product-filter-bar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div className="category-tabs" style={{ display: 'flex', gap: '0.5rem' }}>
          {(['ALL', 'iPhone', 'iPad', 'Mac', 'Watch'] as CategoryTab[]).map((cat) => (
            <button
              key={cat}
              className={`tab-btn ${categoryTab === cat ? 'active' : ''}`}
              onClick={() => setCategoryTab(cat)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {getCategoryTabIcon(cat)}
              {cat === 'ALL' ? 'ทั้งหมด' : cat}
            </button>
          ))}
        </div>

        <div className="product-search-input-wrap">
          <input
            type="search"
            placeholder="ค้นหาสินค้า, รุ่น หรือ SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Notice>กำลังโหลดรายการสินค้า…</Notice>
      ) : filteredProducts.length === 0 ? (
        <Panel title="ไม่พบรายการสินค้า">
          <p className="muted">ยังไม่มีสินค้าในหมวดหมู่นี้ หรือไม่ตรงกับคำค้นหา</p>
          <div style={{ marginTop: '1rem' }}>
            <Button
              onClick={() =>
                setProductModal({
                  open: true,
                  category: categoryTab !== 'ALL' ? categoryTab : 'iPhone',
                  name: '',
                  active: true,
                })
              }
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Plus size={16} />
                เพิ่มสินค้าแรก
              </span>
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="product-card-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {filteredProducts.map((prod) => (
            <Panel
              key={prod.id}
              title={`${prod.name} (${prod.category})`}
              eyebrow={prod.active ? 'ACTIVE PRODUCT' : 'INACTIVE PRODUCT'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span className={`status-tag ${prod.active ? 'status-found' : 'status-outcome'}`}>
                  {prod.active ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Check size={12} /> ใช้งาน
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <X size={12} /> ปิดใช้งาน
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Edit2 size={13} />
                      แก้ไขสินค้า
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setModelModal({
                        open: true,
                        productId: prod.id,
                        name: '',
                        active: true,
                      })
                    }
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Plus size={13} />
                      เพิ่มรุ่น (Model)
                    </span>
                  </Button>
                </div>
              </div>

              <div className="models-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                {prod.models?.length === 0 ? (
                  <p className="fine" style={{ fontStyle: 'italic' }}>
                    ยังไม่มีรุ่นสินค้าภายใต้ {prod.name} · คลิก "+ เพิ่มรุ่น (Model)" เพื่อเริ่มสร้าง
                  </p>
                ) : (
                  prod.models.map((model) => (
                    <div
                      key={model.id}
                      style={{
                        padding: '1rem',
                        background: 'var(--panel-sub-bg, rgba(0, 0, 0, 0.02))',
                        border: '1px solid var(--border-color, #e2e8f0)',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Tag size={16} color="#0abab5" />
                          <strong>{model.name}</strong>
                          <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem' }} className={`status-tag ${model.active ? 'status-found' : 'status-outcome'}`}>
                            {model.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setModelModal({
                                open: true,
                                editingId: model.id,
                                name: model.name,
                                active: model.active,
                              })
                            }
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <Edit2 size={13} />
                              แก้ไขรุ่น
                            </span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
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
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <Plus size={13} />
                              เพิ่ม SKU
                            </span>
                          </Button>
                        </div>
                      </div>

                      {/* SKU Table */}
                      <div className="table-responsive" style={{ marginTop: '0.5rem' }}>
                        {model.skus?.length === 0 ? (
                          <p className="fine">ยังไม่มี SKU · คลิก "+ เพิ่ม SKU"</p>
                        ) : (
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th>SKU Code</th>
                                <th>ชื่อตัวเลือก (Name)</th>
                                <th>ความจุ (Storage)</th>
                                <th>สี (Color)</th>
                                <th>สถานะ</th>
                                <th>จัดการ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {model.skus.map((sku) => (
                                <tr key={sku.id}>
                                  <td><strong>{sku.sku}</strong></td>
                                  <td>{sku.name}</td>
                                  <td>{sku.storage || '—'}</td>
                                  <td>{sku.color || '—'}</td>
                                  <td>
                                    <span className={`status-tag ${sku.active ? 'status-found' : 'status-outcome'}`}>
                                      {sku.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                                    </span>
                                  </td>
                                  <td>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() =>
                                        setSkuModal({
                                          open: true,
                                          editingId: sku.id,
                                          sku: sku.sku,
                                          name: sku.name,
                                          color: sku.color || '',
                                          storage: sku.storage || '',
                                          active: sku.active,
                                        })
                                      }
                                    >
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <Edit2 size={13} />
                                        แก้ไข SKU
                                      </span>
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* Product Modal */}
      {productModal.open && (
        <Modal
          title={productModal.editingId ? 'แก้ไขสินค้าหลัก' : 'เพิ่มสินค้าหลัก'}
          isOpen={productModal.open}
          onClose={() => setProductModal({ ...productModal, open: false })}
        >
          <form onSubmit={handleSaveProduct}>
            <label>
              หมวดหมู่สินค้า (Category)
              <select
                value={productModal.category}
                onChange={(e) =>
                  setProductModal({
                    ...productModal,
                    category: e.target.value as 'iPhone' | 'iPad' | 'Mac' | 'Watch',
                  })
                }
              >
                <option value="iPhone">iPhone</option>
                <option value="iPad">iPad</option>
                <option value="Mac">Mac</option>
                <option value="Watch">Watch</option>
              </select>
            </label>
            <label>
              ชื่อสินค้าหลัก (Product Name)
              <input
                required
                placeholder="เช่น iPhone 16 Pro, iPad Pro 11-inch"
                value={productModal.name}
                onChange={(e) =>
                  setProductModal({ ...productModal, name: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={productModal.active}
                onChange={(e) =>
                  setProductModal({
                    ...productModal,
                    active: e.target.checked,
                  })
                }
              />{' '}
              เปิดใช้งานสินค้านี้
            </label>
            <div className="actions">
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

      {/* Model Modal */}
      {modelModal.open && (
        <Modal
          title={modelModal.editingId ? 'แก้ไขรุ่นสินค้า (Model)' : 'เพิ่มรุ่นสินค้าใหม่ (Model)'}
          isOpen={modelModal.open}
          onClose={() => setModelModal({ ...modelModal, open: false })}
        >
          <form onSubmit={handleSaveModel}>
            <label>
              ชื่อรุ่นสินค้า (Model Name)
              <input
                required
                placeholder="เช่น iPhone 16 Pro 256GB, Wi-Fi + Cellular"
                value={modelModal.name}
                onChange={(e) =>
                  setModelModal({ ...modelModal, name: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={modelModal.active}
                onChange={(e) =>
                  setModelModal({
                    ...modelModal,
                    active: e.target.checked,
                  })
                }
              />{' '}
              เปิดใช้งานรุ่นสินค้านี้
            </label>
            <div className="actions">
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

      {/* SKU Modal */}
      {skuModal.open && (
        <Modal
          title={skuModal.editingId ? 'แก้ไข SKU' : 'เพิ่ม SKU ใหม่'}
          isOpen={skuModal.open}
          onClose={() => setSkuModal({ ...skuModal, open: false })}
        >
          <form onSubmit={handleSaveSku}>
            <label>
              รหัส SKU (SKU Code)
              <input
                required
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
                placeholder="เช่น 256GB Natural Titanium"
                value={skuModal.name}
                onChange={(e) =>
                  setSkuModal({ ...skuModal, name: e.target.value })
                }
              />
            </label>
            <div className="form-grid-2col">
              <label>
                ความจุ (Storage)
                <input
                  placeholder="เช่น 128GB, 256GB, 512GB, 1TB"
                  value={skuModal.storage}
                  onChange={(e) =>
                    setSkuModal({ ...skuModal, storage: e.target.value })
                  }
                />
              </label>
              <label>
                สี (Color)
                <input
                  placeholder="เช่น Natural Titanium, Black"
                  value={skuModal.color}
                  onChange={(e) =>
                    setSkuModal({ ...skuModal, color: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={skuModal.active}
                onChange={(e) =>
                  setSkuModal({
                    ...skuModal,
                    active: e.target.checked,
                  })
                }
              />{' '}
              เปิดใช้งาน SKU นี้
            </label>
            <div className="actions">
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
