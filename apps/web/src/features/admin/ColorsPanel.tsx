import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Palette, Plus, Search, Check, Trash2, RotateCcw } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';

export interface ColorSkuInfo {
  sku: string;
  name: string;
}

export interface ColorItem {
  id: string | null;
  name: string;
  hexCode: string;
  skuCount: number;
  skus?: ColorSkuInfo[];
}

export function isImageUrl(val: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return /^https?:\/\/.+/i.test(trimmed) || /^data:image\/.+/i.test(trimmed);
}

export function isValidColorOrUrl(val: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return (
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed) ||
    isImageUrl(trimmed)
  );
}

function SkuHoverCell({
  item,
  onManage,
}: {
  item: ColorItem;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="status-tag"
        onClick={onManage}
        title="คลิกเพื่อจัดการ / ผูก SKU กับสีนี้"
        style={{
          fontSize: '0.8rem',
          padding: '4px 10px',
          background: item.skuCount > 0 ? '#e0f2fe' : '#f3f4f6',
          color: item.skuCount > 0 ? '#0369a1' : '#6b7280',
          cursor: 'pointer',
          fontWeight: 600,
          borderRadius: '12px',
          border: '1px solid transparent',
          transition: 'all 0.15s ease',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span>{item.skuCount} SKU</span>
        <span style={{ fontSize: '10px', color: '#0284c7' }}>⚙</span>
      </button>

      {open && item.skuCount > 0 && item.skus && item.skus.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: '0',
            top: 'calc(100% + 6px)',
            zIndex: 100,
            background: '#ffffff',
            border: '1px solid var(--border-color, #cbd5e1)',
            borderRadius: '8px',
            boxShadow:
              '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            padding: '10px 12px',
            minWidth: '280px',
            maxWidth: '380px',
            maxHeight: '260px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-primary, #1e293b)',
              marginBottom: '6px',
              borderBottom: '1px solid #f1f5f9',
              paddingBottom: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>รายการสินค้าสี &ldquo;{item.name}&rdquo; ({item.skus.length} SKU)</span>
            <small style={{ color: '#0284c7', cursor: 'pointer' }} onClick={onManage}>
              จัดการ
            </small>
          </div>
          <div style={{ display: 'grid', gap: '6px' }}>
            {item.skus.map((s, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: '11.5px',
                  lineHeight: '1.35',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  background: '#f8fafc',
                }}
              >
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f766e' }}>
                  {s.sku}
                </div>
                <div style={{ color: '#475569' }}>{s.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ColorsPanel() {
  const toast = useToast();
  const [colors, setColors] = useState<ColorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unassigned' | 'assigned'>('all');

  // Local draft changes: map of color name -> hexCode
  const [draftHex, setDraftHex] = useState<Record<string, string>>({});

  // Modal to add a new color
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#000000');

  // Modal to manage SKUs of a color
  const [managingColor, setManagingColor] = useState<ColorItem | null>(null);
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const [skuSearchResults, setSkuSearchResults] = useState<{ sku: string; name: string; color: string | null }[]>([]);
  const [searchingSkus, setSearchingSkus] = useState(false);
  const [reassignColorMap, setReassignColorMap] = useState<Record<string, string>>({});

  // Modal to delete a color (with migrate or unbind option)
  const [deletingColor, setDeletingColor] = useState<ColorItem | null>(null);
  const [deleteMode, setDeleteMode] = useState<'migrate' | 'unbind'>('migrate');
  const [targetMigrateColor, setTargetMigrateColor] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<ColorItem[]>('/colors');
      setColors(data);
      // Initialize draft values
      const drafts: Record<string, string> = {};
      for (const c of data) {
        drafts[c.name] = c.hexCode || '';
      }
      setDraftHex(drafts);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลสีไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const total = colors.length;
    const assigned = colors.filter((c) => Boolean(c.hexCode?.trim())).length;
    const unassigned = total - assigned;
    return { total, assigned, unassigned };
  }, [colors]);

  const filteredColors = useMemo(() => {
    return colors.filter((c) => {
      if (filterMode === 'assigned' && !c.hexCode?.trim()) return false;
      if (filterMode === 'unassigned' && Boolean(c.hexCode?.trim())) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesNameOrHex =
          c.name.toLowerCase().includes(q) ||
          (c.hexCode && c.hexCode.toLowerCase().includes(q));
        const matchesSku =
          c.skus?.some(
            (s) =>
              s.sku.toLowerCase().includes(q) ||
              s.name.toLowerCase().includes(q),
          ) ?? false;
        return matchesNameOrHex || matchesSku;
      }
      return true;
    });
  }, [colors, filterMode, search]);

  const handleHexChange = (name: string, val: string) => {
    setDraftHex((prev) => ({
      ...prev,
      [name]: val,
    }));
  };

  const handleSaveColor = async (name: string) => {
    const val = (draftHex[name] || '').trim();
    if (!val) {
      toast.error('กรุณาระบุรหัสสี เช่น #1C1C1E หรือ Image URL');
      return;
    }
    if (!isValidColorOrUrl(val)) {
      toast.error('รหัสสีต้องขึ้นต้นด้วย # (เลขฐาน 16) หรือเป็น URL รูปภาพ (http/https/data:image)');
      return;
    }

    setBusy(true);
    try {
      await api('/colors', 'POST', { name, hexCode: val });
      toast.success(`บันทึกสี "${name}" เรียบร้อย`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกสีไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleSearchSkus = async (q: string) => {
    setSkuSearchQuery(q);
    if (!q.trim()) {
      setSkuSearchResults([]);
      return;
    }
    setSearchingSkus(true);
    try {
      const results = await api<{ sku: string; name: string; color: string | null }[]>(
        `/colors/search-skus?q=${encodeURIComponent(q.trim())}`,
      );
      setSkuSearchResults(results || []);
    } catch {
      setSkuSearchResults([]);
    } finally {
      setSearchingSkus(false);
    }
  };

  const handleBindSku = async (sku: string, colorName: string | null) => {
    setBusy(true);
    try {
      await api('/colors/bind-sku', 'POST', { sku, colorName });
      toast.success(
        colorName
          ? `ผูก SKU ${sku} เข้ากับสี "${colorName}" เรียบร้อย`
          : `ปลดสีออกจาก SKU ${sku} เรียบร้อย`,
      );
      await load();
      if (managingColor) {
        const updatedList = await api<ColorItem[]>('/colors');
        const updatedManaging = updatedList.find((c) => c.name === managingColor.name);
        setManagingColor(updatedManaging || null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteColor = (item: ColorItem) => {
    setDeletingColor(item);
    setDeleteMode('migrate');
    const firstOther = colors.find((c) => c.name !== item.name)?.name || '';
    setTargetMigrateColor(firstOther);
  };

  const handleConfirmDelete = async () => {
    if (!deletingColor) return;
    setBusy(true);
    try {
      if (deletingColor.skuCount > 0) {
        if (deleteMode === 'migrate') {
          if (!targetMigrateColor) {
            toast.error('กรุณาเลือกสีปลายทางที่จะย้าย SKU ไป');
            setBusy(false);
            return;
          }
          await api('/colors/migrate-skus', 'POST', {
            fromColor: deletingColor.name,
            toColor: targetMigrateColor,
          });
          toast.success(
            `ย้ายสินค้า ${deletingColor.skuCount} SKU ไปยังสี "${targetMigrateColor}" เรียบร้อย`,
          );
        } else {
          await api('/colors/migrate-skus', 'POST', {
            fromColor: deletingColor.name,
            toColor: null,
          });
          toast.success(`ปลดสีออกจาก ${deletingColor.skuCount} SKU เรียบร้อย`);
        }
      }
      if (deletingColor.id) {
        await api(`/colors/${deletingColor.id}`, 'DELETE');
      }
      toast.success(`ลบสี "${deletingColor.name}" เรียบร้อย`);
      setDeletingColor(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNewColor = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newColorName.trim();
    const val = newColorHex.trim();
    if (!name) {
      toast.error('กรุณาระบุชื่อสี');
      return;
    }
    if (!isValidColorOrUrl(val)) {
      toast.error('รหัสสีไม่ถูกต้อง ต้องเป็น #RRGGBB หรือ URL รูปภาพ');
      return;
    }

    setBusy(true);
    try {
      await api('/colors', 'POST', { name, hexCode: val });
      toast.success(`เพิ่มสี "${name}" เรียบร้อย`);
      setAddModalOpen(false);
      setNewColorName('');
      setNewColorHex('#000000');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เพิ่มสีไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Palette size={20} color="#0abab5" />
            <span>จัดการสีสินค้า (Color Palette)</span>
          </div>
          <Button size="sm" onClick={() => setAddModalOpen(true)} disabled={busy}>
            <Plus size={16} />
            เพิ่มชื่อสีใหม่
          </Button>
        </div>
      }
    >
      <Notice>
        รวบรวมชื่อสีสินค้าจาก ERP และในระบบอัตโนมัติ ให้คุณกำหนดรหัสสี (Hex Code) กลางได้ในที่เดียว
        เมื่อมีการซิงก์ข้อมูลจาก ERP ใหม่ รหัสสีที่คุณตั้งไว้จะยังคงอยู่และไม่ถูกเขียนทับ
      </Notice>

      {error && <Notice error>{error}</Notice>}

      {/* SUMMARY BADGES */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          margin: '1rem 0',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setFilterMode('all')}
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            border: filterMode === 'all' ? '2px solid #0abab5' : '1px solid var(--border-color, #e5e7eb)',
            background: filterMode === 'all' ? '#e6f7f6' : 'transparent',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: filterMode === 'all' ? 600 : 400,
          }}
        >
          ทั้งหมด: <strong>{stats.total}</strong> สี
        </button>
        <button
          type="button"
          onClick={() => setFilterMode('assigned')}
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            border: filterMode === 'assigned' ? '2px solid #10b981' : '1px solid var(--border-color, #e5e7eb)',
            background: filterMode === 'assigned' ? '#ecfdf5' : 'transparent',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: filterMode === 'assigned' ? 600 : 400,
          }}
        >
          กำหนดรหัสสีแล้ว: <strong>{stats.assigned}</strong> สี
        </button>
        <button
          type="button"
          onClick={() => setFilterMode('unassigned')}
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            border: filterMode === 'unassigned' ? '2px solid #f59e0b' : '1px solid var(--border-color, #e5e7eb)',
            background: filterMode === 'unassigned' ? '#fffbeb' : 'transparent',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: filterMode === 'unassigned' ? 600 : 400,
          }}
        >
          ยังไม่กำหนด: <strong>{stats.unassigned}</strong> สี
        </button>
      </div>

      {/* SEARCH BAR */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '1rem',
        }}
      >
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#9ca3af',
            }}
          />
          <input
            type="text"
            placeholder="ค้นหาชื่อสี, รหัส SKU, หรือชื่อสินค้า เช่น Saddle Brown, Case, Silicone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '34px', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {loading ? (
        <p className="muted">กำลังโหลดข้อมูลสี…</p>
      ) : filteredColors.length === 0 ? (
        <p className="muted" style={{ fontStyle: 'italic', padding: '1rem 0' }}>
          ไม่พบรายการสีที่ตรงกับเงื่อนไข
        </p>
      ) : (
        <div className="table-responsive">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color, #e5e7eb)', textAlign: 'left' }}>
                <th style={{ width: '48px', padding: '10px 8px' }}>สี</th>
                <th style={{ padding: '10px 8px' }}>ชื่อสี (Color Name)</th>
                <th style={{ padding: '10px 8px', width: '120px' }}>จำนวน SKU</th>
                <th style={{ padding: '10px 8px', minWidth: '240px' }}>รหัสสี (Hex Code) หรือ Image URL</th>
                <th style={{ padding: '10px 8px', width: '120px', textAlign: 'right' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filteredColors.map((c) => {
                const currentDraft = draftHex[c.name] ?? c.hexCode ?? '';
                const isModified = currentDraft !== (c.hexCode ?? '');
                const isImg = isImageUrl(currentDraft);
                const valid = isValidColorOrUrl(currentDraft);
                const previewColor = !isImg && valid ? currentDraft : '#e5e7eb';

                return (
                  <tr
                    key={c.name}
                    style={{
                      borderBottom: '1px solid var(--border-color, #e5e7eb)',
                      backgroundColor: isModified ? 'var(--bg-subtle, #f0fdf4)' : undefined,
                    }}
                  >
                    {/* COLOR SWATCH */}
                    <td style={{ padding: '8px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: previewColor,
                          backgroundImage: isImg ? `url("${currentDraft}")` : undefined,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat',
                          border: '1px solid rgba(0, 0, 0, 0.2)',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                          verticalAlign: 'middle',
                        }}
                        title={valid ? (isImg ? `รูปภาพสี: ${currentDraft}` : currentDraft) : 'ยังไม่กำหนดรหัสสี'}
                      />
                    </td>

                    {/* NAME */}
                    <td style={{ padding: '8px' }}>
                      <strong>{c.name}</strong>
                    </td>

                    {/* SKU COUNT WITH HOVER TOOLTIP */}
                    <td style={{ padding: '8px' }}>
                      <SkuHoverCell item={c} onManage={() => setManagingColor(c)} />
                    </td>

                    {/* HEX CODE PICKER + INPUT */}
                    <td style={{ padding: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {!isImg && (
                          <input
                            type="color"
                            disabled={busy}
                            value={valid && !isImg ? currentDraft.slice(0, 7) : '#000000'}
                            onChange={(e) => handleHexChange(c.name, e.target.value.toUpperCase())}
                            style={{
                              width: '32px',
                              height: '32px',
                              padding: '0',
                              border: '1px solid var(--border-color, #ccc)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                            title="เลือกสีจากจานสี"
                          />
                        )}
                        <input
                          type="text"
                          disabled={busy}
                          placeholder="#000000 หรือ URL รูปภาพ"
                          value={currentDraft}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleHexChange(
                              c.name,
                              val.startsWith('http') || val.startsWith('data:') ? val : val.toUpperCase(),
                            );
                          }}
                          style={{
                            width: '100%',
                            minWidth: '160px',
                            fontFamily: isImg ? 'inherit' : 'monospace',
                            fontSize: '0.85rem',
                            padding: '4px 8px',
                          }}
                        />
                      </div>
                    </td>

                    {/* ACTION BUTTONS */}
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                        <Button
                          variant={isModified ? 'primary' : 'secondary'}
                          size="sm"
                          disabled={busy || !isModified || !valid}
                          onClick={() => void handleSaveColor(c.name)}
                          title="บันทึกรหัสสี"
                        >
                          <Check size={14} />
                          บันทึก
                        </Button>
                        {(c.id || c.skuCount > 0) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => void handleDeleteColor(c)}
                            title={c.skuCount > 0 ? 'ลบหรือย้ายสินค้าของสีนี้' : 'ลบรหัสสีนี้'}
                          >
                            <Trash2 size={14} color="#ef4444" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL TO ADD NEW COLOR */}
      {addModalOpen && (
        <Modal
          title="เพิ่มชื่อสีสินค้าใหม่"
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
        >
          <form onSubmit={handleCreateNewColor}>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              ระบุชื่อสีและรหัสสี (Hex Code) เพื่อใช้จับคู่กับสินค้าที่นำเข้าจาก ERP หรือที่สร้างเอง
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <label>
                ชื่อสี (เช่น Space Black, Natural Titanium)
                <input
                  required
                  autoFocus
                  placeholder="เช่น Space Black"
                  value={newColorName}
                  onChange={(e) => setNewColorName(e.target.value)}
                />
              </label>

              <label>
                รหัสสี (Hex Code) หรือ Image URL
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  {!isImageUrl(newColorHex) && (
                    <input
                      type="color"
                      value={newColorHex.startsWith('#') ? newColorHex.slice(0, 7) : '#000000'}
                      onChange={(e) => setNewColorHex(e.target.value.toUpperCase())}
                      style={{
                        width: '40px',
                        height: '36px',
                        padding: 0,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <input
                    required
                    placeholder="#1C1C1E หรือ https://.../image.png"
                    value={newColorHex}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewColorHex(val.startsWith('http') || val.startsWith('data:') ? val : val.toUpperCase());
                    }}
                    style={{ fontFamily: isImageUrl(newColorHex) ? 'inherit' : 'monospace', flex: 1 }}
                  />
                </div>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '0.5rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    backgroundColor: !isImageUrl(newColorHex) && isValidColorOrUrl(newColorHex) ? newColorHex : '#e5e7eb',
                    backgroundImage: isImageUrl(newColorHex) ? `url("${newColorHex}")` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: '1px solid rgba(0,0,0,0.2)',
                  }}
                />
                <span className="muted" style={{ fontSize: '0.9rem' }}>
                  ตัวอย่างการแสดงผลสี
                </span>
              </div>
            </div>

            <div className="actions" style={{ marginTop: '1.5rem' }}>
              <Button type="submit" disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'เพิ่มสี'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setAddModalOpen(false)}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL TO MANAGE SKUS BOUND TO A COLOR */}
      {managingColor && (
        <Modal
          title={`จัดการสินค้าที่ผูกกับสี "${managingColor.name}"`}
          isOpen={Boolean(managingColor)}
          onClose={() => {
            setManagingColor(null);
            setSkuSearchQuery('');
            setSkuSearchResults([]);
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              สินค้าที่มีสีนี้จะมีจุดเลือกสี (Swatch) ในระบบเป็นรหัสสีของ &ldquo;{managingColor.name}&rdquo;
            </p>

            {/* SECTION 1: SEARCH & BIND MORE SKUS */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px',
              }}
            >
              <label style={{ fontWeight: 600, fontSize: '0.9rem', display: 'block', marginBottom: '6px' }}>
                + ผูก SKU เพิ่มเติมเข้ากับสีนี้
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="พิมพ์รหัส SKU หรือชื่อสินค้า เช่น MHYC3, Leather, Silicone..."
                  value={skuSearchQuery}
                  onChange={(e) => void handleSearchSkus(e.target.value)}
                  style={{ flex: 1, fontSize: '13px' }}
                />
              </div>

              {searchingSkus && <p className="fine muted" style={{ marginTop: '6px' }}>กำลังค้นหา SKU...</p>}

              {skuSearchResults.length > 0 && (
                <div
                  style={{
                    marginTop: '8px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    background: '#ffffff',
                  }}
                >
                  {skuSearchResults.map((res) => {
                    const isAlreadyBound = managingColor.skus?.some((s) => s.sku === res.sku);
                    return (
                      <div
                        key={res.sku}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderBottom: '1px solid #f1f5f9',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, marginRight: '8px' }}>
                          <strong style={{ fontFamily: 'monospace', color: '#0f766e' }}>{res.sku}</strong>
                          <div style={{ color: '#475569' }}>{res.name}</div>
                          {res.color && (
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              (สีปัจจุบัน: {res.color})
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          disabled={busy || isAlreadyBound}
                          onClick={() => void handleBindSku(res.sku, managingColor.name)}
                        >
                          {isAlreadyBound ? 'ผูกอยู่แล้ว' : '+ ผูกสีนี้'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SECTION 2: CURRENT BOUND SKUS */}
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '8px' }}>
                รายการสินค้าที่ผูกอยู่ปัจจุบัน ({managingColor.skus?.length || 0} SKU)
              </div>
              {!managingColor.skus || managingColor.skus.length === 0 ? (
                <p className="muted fine" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                  ยังไม่มีสินค้าผูกกับสีนี้
                </p>
              ) : (
                <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'grid', gap: '8px' }}>
                  {managingColor.skus.map((s) => (
                    <div
                      key={s.sku}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        background: '#ffffff',
                        gap: '8px',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f766e', fontSize: '12px' }}>
                          {s.sku}
                        </div>
                        <div style={{ fontSize: '12px', color: '#334155', wordBreak: 'break-word' }}>
                          {s.name}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <select
                          value={reassignColorMap[s.sku] || ''}
                          onChange={(e) =>
                            setReassignColorMap((prev) => ({ ...prev, [s.sku]: e.target.value }))
                          }
                          style={{ fontSize: '12px', padding: '4px 6px', maxWidth: '120px' }}
                        >
                          <option value="">ย้ายไปสี...</option>
                          {colors
                            .filter((c) => c.name !== managingColor.name)
                            .map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={busy || !reassignColorMap[s.sku]}
                          onClick={() => void handleBindSku(s.sku, reassignColorMap[s.sku])}
                          title="ย้ายสินค้าไปยังสีที่เลือก"
                        >
                          ย้าย
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleBindSku(s.sku, null)}
                          title="ปลดสีออกจากสินค้านี้"
                          style={{ color: '#dc2626' }}
                        >
                          ปลดออก
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="actions" style={{ marginTop: '8px' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setManagingColor(null);
                  setSkuSearchQuery('');
                  setSkuSearchResults([]);
                }}
              >
                ปิด
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL TO CONFIRM DELETION OR MIGRATION */}
      {deletingColor && (
        <Modal
          title={`ลบสี "${deletingColor.name}"`}
          isOpen={Boolean(deletingColor)}
          onClose={() => setDeletingColor(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {deletingColor.skuCount > 0 ? (
              <>
                <p style={{ margin: 0, fontSize: '0.95rem', color: '#b91c1c', fontWeight: 600 }}>
                  สี &ldquo;{deletingColor.name}&rdquo; มีสินค้าผูกอยู่ {deletingColor.skuCount} SKU
                </p>
                <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
                  กรุณาเลือกวิธีการจัดการสินค้าที่เคยผูกอยู่กับสีนี้:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: `1.5px solid ${deleteMode === 'migrate' ? 'var(--primary)' : '#e2e8f0'}`,
                      background: deleteMode === 'migrate' ? 'var(--primary-subtle)' : '#ffffff',
                    }}
                  >
                    <input
                      type="radio"
                      name="deleteMode"
                      checked={deleteMode === 'migrate'}
                      onChange={() => setDeleteMode('migrate')}
                      style={{ marginTop: '2px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>ย้าย SKU ทั้งหมดไปรวมกับสีอื่น</strong>
                      <div className="fine muted" style={{ marginBottom: '6px' }}>
                        เช่น ย้ายจาก {deletingColor.name} ไปยัง Citrus
                      </div>
                      {deleteMode === 'migrate' && (
                        <select
                          value={targetMigrateColor}
                          onChange={(e) => setTargetMigrateColor(e.target.value)}
                          style={{ width: '100%', fontSize: '13px', padding: '6px 8px' }}
                        >
                          <option value="">-- เลือกสีปลายทาง --</option>
                          {colors
                            .filter((c) => c.name !== deletingColor.name)
                            .map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name} ({c.skuCount} SKU)
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: `1.5px solid ${deleteMode === 'unbind' ? 'var(--primary)' : '#e2e8f0'}`,
                      background: deleteMode === 'unbind' ? 'var(--primary-subtle)' : '#ffffff',
                    }}
                  >
                    <input
                      type="radio"
                      name="deleteMode"
                      checked={deleteMode === 'unbind'}
                      onChange={() => setDeleteMode('unbind')}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <strong>ปลดสีออกจาก SKU ทั้งหมด (ลบสีนี้ทิ้ง)</strong>
                      <div className="fine muted">
                        สินค้าทั้ง {deletingColor.skuCount} SKU จะไม่มีสีนี้ติดอยู่ และสีนี้จะไม่ปรากฏในระบบอีก
                      </div>
                    </div>
                  </label>
                </div>
              </>
            ) : (
              <p style={{ margin: 0 }}>
                ต้องการลบการตั้งค่าสี &ldquo;{deletingColor.name}&rdquo; หรือไม่?
              </p>
            )}

            <div className="actions" style={{ marginTop: '1rem' }}>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  (deletingColor.skuCount > 0 &&
                    deleteMode === 'migrate' &&
                    !targetMigrateColor)
                }
                onClick={() => void handleConfirmDelete()}
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
              >
                {busy ? 'กำลังดำเนินการ…' : 'ยืนยันการลบ'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setDeletingColor(null)}
              >
                ยกเลิก
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
