import { useState, useMemo } from 'react';
import {
  ClipboardList,
  Building2,
  User as UserIcon,
  Phone,
  Clock,
  Package,
  Search,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  Calendar,
  Download,
  CheckSquare,
  Square,
  RotateCcw,
  Info,
} from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { Summary } from '../session/Summary';
import type { MockSession, MockUser, Timestamp } from '../../types/session';

interface SessionLogsWorkspaceProps {
  user: MockUser;
  sessions: MockSession[];
}

type StatusFilter =
  | 'ALL'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'NOT_BUY'
  | 'OUT_OF_STOCK'
  | 'CANCELLED';

type PageSize = 15 | 25 | 50;

function formatWalkInTime(isoStr?: string): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimestampForExport(isoStr?: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function getSessionTimestamp(
  s: MockSession,
  key: Timestamp,
  eventTypes?: string[],
): string {
  if (s.timestamps[key]) {
    return formatTimestampForExport(s.timestamps[key]);
  }
  if (s.events && eventTypes && eventTypes.length > 0) {
    const evt = s.events.find((e) => eventTypes.includes(e.eventType));
    if (evt) {
      return formatTimestampForExport(evt.createdAt);
    }
  }
  return '';
}

function getLatestItemText(s: MockSession): string {
  if (s.selection?.product?.model) {
    const accCount = Object.keys(s.selection.accessories || {}).length;
    return accCount > 0
      ? `${s.selection.product.model} (+${accCount} อุปกรณ์เสริม)`
      : s.selection.product.model;
  }
  if (s.selection?.product?.product) {
    return s.selection.product.product;
  }
  if (s.state === 'WALK_IN' || s.state === 'DEMO') {
    return 'กำลัง DEMO / ให้คำปรึกษา';
  }
  if (s.state === 'PRODUCT_SELECTION') {
    return 'กำลังเลือกสินค้า';
  }
  return 'ยังไม่ระบุสินค้า';
}

function renderStatusTag(s: MockSession) {
  if (s.state === 'WALK_IN') {
    return (
      <span
        className="status-tag"
        style={{ background: '#fdf3e7', color: '#a8621d' }}
      >
        ลูกค้าเดินเข้าร้าน
      </span>
    );
  }
  if (s.state === 'DEMO') {
    return (
      <span
        className="status-tag"
        style={{ background: '#fdf3e7', color: '#a8621d' }}
      >
        DEMO
      </span>
    );
  }
  if (s.state === 'PRODUCT_SELECTION') {
    return (
      <span
        className="status-tag"
        style={{ background: '#fdf3e7', color: '#a8621d' }}
      >
        กำลังเลือกสินค้า
      </span>
    );
  }
  if (s.outcome === 'NOT_BUY') {
    return (
      <span
        className="status-tag"
        style={{ background: '#fef3c7', color: '#92400e' }}
      >
        ไม่ซื้อ
      </span>
    );
  }
  if (s.outcome === 'OUT_OF_STOCK') {
    return (
      <span
        className="status-tag"
        style={{ background: '#fee2e2', color: '#991b1b' }}
      >
        สินค้าหมด
      </span>
    );
  }
  if (s.outcome === 'CUSTOMER_CANCELLED') {
    return (
      <span
        className="status-tag"
        style={{ background: '#fee2e2', color: '#991b1b' }}
      >
        ยกเลิก
      </span>
    );
  }
  if (s.state === 'COMPLETED') {
    return (
      <span
        className="status-tag"
        style={{ background: '#e6f4ea', color: '#137333' }}
      >
        สำเร็จ
      </span>
    );
  }
  return (
    <span
      className="status-tag"
      style={{ background: '#fdf3e7', color: '#a8621d' }}
    >
      กำลังบริการ ({s.state})
    </span>
  );
}

// Export column definitions grouped by category
interface ExportColumn {
  key: string;
  label: string;
  getValue: (s: MockSession) => string;
}

interface ExportCategory {
  category: string;
  columns: ExportColumn[];
}

const EXPORT_CATEGORIES: ExportCategory[] = [
  {
    category: '1. ข้อมูลพื้นฐาน Session',
    columns: [
      { key: 'reference', label: 'Session Reference', getValue: (s) => s.reference },
      {
        key: 'walkInAt',
        label: 'วันที่และเวลา Walk-in',
        getValue: (s) =>
          formatTimestampForExport(s.timestamps.customer_walk_in_at),
      },
      { key: 'branchCode', label: 'รหัสสาขา (Branch Code)', getValue: (s) => s.branchCode },
      { key: 'branchName', label: 'ชื่อสาขา', getValue: (s) => s.branchName || '' },
      { key: 'staffId', label: 'ผู้ดูแล (Staff ID)', getValue: (s) => s.staffId },
      { key: 'phone', label: 'เบอร์โทรศัพท์ลูกค้า', getValue: (s) => s.phone || '' },
    ],
  },
  {
    category: '2. ข้อมูลสินค้าและอุปกรณ์',
    columns: [
      {
        key: 'category',
        label: 'หมวดหมู่สินค้า',
        getValue: (s) => s.selection?.product?.category || '',
      },
      {
        key: 'product',
        label: 'ชื่อสินค้า',
        getValue: (s) => s.selection?.product?.product || '',
      },
      {
        key: 'model',
        label: 'รุ่นสินค้า (Model)',
        getValue: (s) => s.selection?.product?.model || '',
      },
      {
        key: 'sku',
        label: 'รหัส SKU',
        getValue: (s) => s.selection?.product?.sku || '',
      },
      {
        key: 'accessories',
        label: 'รายการอุปกรณ์เสริม',
        getValue: (s) =>
          Object.entries(s.selection?.accessories || {})
            .map(([item, qty]) => `${item} (x${qty})`)
            .join('; '),
      },
    ],
  },
  {
    category: '3. สิทธิพิเศษและการชำระเงิน',
    columns: [
      {
        key: 'ontop',
        label: 'Ontop',
        getValue: (s) => (s.selection?.ontop || []).join('; '),
      },
      {
        key: 'points',
        label: 'Points',
        getValue: (s) => (s.selection?.points || []).join('; '),
      },
      {
        key: 'burnPoints',
        label: 'Burn Points',
        getValue: (s) => (s.selection?.burnPoints || []).join('; '),
      },
      {
        key: 'payments',
        label: 'ช่องทางการชำระเงิน',
        getValue: (s) => (s.selection?.payments || []).join('; '),
      },
    ],
  },
  {
    category: '4. สถานะและผลลัพธ์',
    columns: [
      { key: 'state', label: 'ขั้นตอนปัจจุบัน (State)', getValue: (s) => s.state },
      { key: 'outcome', label: 'ผลลัพธ์ (Outcome)', getValue: (s) => s.outcome || '' },
      { key: 'reason', label: 'เหตุผลสิ้นสุด/ยกเลิก', getValue: (s) => s.reason || '' },
      {
        key: 'otherReason',
        label: 'รายละเอียดเหตุผลเพิ่มเติม',
        getValue: (s) => s.otherReason || '',
      },
      {
        key: 'cancelledBy',
        label: 'ผู้บันทึกยกเลิก',
        getValue: (s) => s.cancelledBy || '',
      },
    ],
  },
  {
    category: '5. บันทึกเวลา (Timestamps ครบทุกขั้นตอน)',
    columns: [
      {
        key: 'ts_customer_walk_in_at',
        label: 'Customer Walk-in At',
        getValue: (s) =>
          getSessionTimestamp(s, 'customer_walk_in_at', [
            'WALK_IN',
            'CUSTOMER_WALK_IN',
          ]),
      },
      {
        key: 'ts_demo_start_at',
        label: 'Demo Start At',
        getValue: (s) =>
          getSessionTimestamp(s, 'demo_start_at', [
            'DEMO_START',
            'DEMO_STARTED',
          ]),
      },
      {
        key: 'ts_demo_end_at',
        label: 'Demo End At',
        getValue: (s) =>
          getSessionTimestamp(s, 'demo_end_at', [
            'DEMO_END',
            'DEMO_ENDED',
          ]),
      },
      {
        key: 'ts_decision_at',
        label: 'Decision At',
        getValue: (s) =>
          getSessionTimestamp(s, 'decision_at', [
            'DECISION',
            'CUSTOMER_DECISION',
            'BUY',
            'NOT_BUY',
          ]),
      },
      {
        key: 'ts_product_selection_start_at',
        label: 'Product Selection Start At',
        getValue: (s) =>
          getSessionTimestamp(s, 'product_selection_start_at', [
            'PRODUCT_SELECTION_START',
            'PRODUCT_SELECTION',
          ]),
      },
      {
        key: 'ts_product_selection_confirmed_at',
        label: 'Product Selection Confirmed At',
        getValue: (s) =>
          getSessionTimestamp(s, 'product_selection_confirmed_at', [
            'CONFIRMATION',
            'PURCHASE_CONFIRMED',
          ]),
      },
      {
        key: 'ts_stock_requested_at',
        label: 'Stock Requested At',
        getValue: (s) =>
          getSessionTimestamp(s, 'stock_requested_at', [
            'STOCK_REQUESTED',
          ]),
      },
      {
        key: 'ts_stock_started_at',
        label: 'Stock Started At',
        getValue: (s) =>
          getSessionTimestamp(s, 'stock_started_at', [
            'SEARCHING',
            'STOCK_STARTED',
          ]),
      },
      {
        key: 'ts_stock_found_at',
        label: 'Stock Found At',
        getValue: (s) =>
          getSessionTimestamp(s, 'stock_found_at', [
            'FOUND',
            'STOCK_FOUND',
          ]),
      },
      {
        key: 'ts_cashier_received_at',
        label: 'Cashier Received At',
        getValue: (s) =>
          getSessionTimestamp(s, 'cashier_received_at', [
            'CASHIER_RECEIVED',
          ]),
      },
      {
        key: 'ts_cashier_scan_at',
        label: 'Cashier Scan At',
        getValue: (s) =>
          getSessionTimestamp(s, 'cashier_scan_at', [
            'CASHIER_SCAN',
          ]),
      },
      {
        key: 'ts_bill_opened_at',
        label: 'Bill Opened At',
        getValue: (s) =>
          getSessionTimestamp(s, 'bill_opened_at', [
            'BILL_OPENED',
            'COMPLETED',
          ]),
      },
      {
        key: 'ts_cancelled_at',
        label: 'Cancelled At',
        getValue: (s) =>
          getSessionTimestamp(s, 'cancelled_at', [
            'CANCELLED',
            'CUSTOMER_CANCELLED',
          ]),
      },
    ],
  },
];

const ALL_COLUMN_KEYS = EXPORT_CATEGORIES.flatMap((cat) =>
  cat.columns.map((col) => col.key),
);

// CSV Export Modal Component
function ExportModal({
  isOpen,
  onClose,
  sessions,
  isAdmin,
  branchOptions,
  initialStartDate,
  initialEndDate,
  initialBranch,
}: {
  isOpen: boolean;
  onClose: () => void;
  sessions: MockSession[];
  isAdmin: boolean;
  branchOptions: { code: string; name: string }[];
  initialStartDate: string;
  initialEndDate: string;
  initialBranch: string;
}) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>(ALL_COLUMN_KEYS);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [selectedBranches, setSelectedBranches] = useState<string[]>(() => {
    if (initialBranch && initialBranch !== 'ALL') {
      return [initialBranch];
    }
    return branchOptions.map((b) => b.code);
  });

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSelectAllColumns = () => setSelectedColumns(ALL_COLUMN_KEYS);
  const handleClearAllColumns = () => setSelectedColumns([]);

  const toggleBranch = (code: string) => {
    setSelectedBranches((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleSelectAllBranches = () =>
    setSelectedBranches(branchOptions.map((b) => b.code));
  const handleClearAllBranches = () => setSelectedBranches([]);

  const handleExport = () => {
    if (isAdmin && selectedBranches.length === 0) {
      alert('กรุณาเลือกอย่างน้อย 1 สาขาที่ต้องการ Export');
      return;
    }

    if (selectedColumns.length === 0) {
      alert('กรุณาเลือกอย่างน้อย 1 คอลัมน์ที่ต้องการ Export');
      return;
    }

    // Filter sessions
    const filtered = sessions.filter((s) => {
      // Multi-branch filter
      if (isAdmin) {
        if (!selectedBranches.includes(s.branchCode) && !selectedBranches.includes(s.branchName)) {
          return false;
        }
      }

      // Date range filter
      if (startDate) {
        const walkIn = s.timestamps.customer_walk_in_at;
        if (!walkIn) return false;
        if (new Date(walkIn) < new Date(`${startDate}T00:00:00`)) return false;
      }
      if (endDate) {
        const walkIn = s.timestamps.customer_walk_in_at;
        if (!walkIn) return false;
        if (new Date(walkIn) > new Date(`${endDate}T23:59:59.999`)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      alert('ไม่พบข้อมูล Session ที่ตรงกับเงื่อนไขช่วงวันที่หรือสาขาที่เลือก');
      return;
    }

    // Prepare active column objects
    const allColsMap = new Map<string, ExportColumn>();
    EXPORT_CATEGORIES.forEach((cat) => {
      cat.columns.forEach((col) => allColsMap.set(col.key, col));
    });
    const activeCols = selectedColumns
      .map((k) => allColsMap.get(k))
      .filter((c): c is ExportColumn => Boolean(c));

    // Build CSV header and rows
    const escapeCsv = (str: string): string => {
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = activeCols.map((c) => escapeCsv(c.label)).join(',');
    const dataLines = filtered.map((s) =>
      activeCols.map((c) => escapeCsv(c.getValue(s))).join(','),
    );

    const csvContent = [headerLine, ...dataLines].join('\r\n');

    // Create UTF-8 BOM blob and trigger download
    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = url;
    link.setAttribute('download', `customer_session_logs_${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    onClose();
  };

  return (
    <Modal
      title={
        <>
          <Download size={18} color="#0abab5" />
          <span>Export ข้อมูล Customer Session Logs</span>
        </>
      }
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="760px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Date Filters in modal */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
            background: '#f8faf9',
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid #e2ebe6',
          }}
        >
          <div>
            <label style={{ margin: 0, fontWeight: 600, fontSize: '12px' }}>
              จากวันที่:
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ marginTop: '4px' }}
              />
            </label>
          </div>
          <div>
            <label style={{ margin: 0, fontWeight: 600, fontSize: '12px' }}>
              ถึงวันที่:
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ marginTop: '4px' }}
              />
            </label>
          </div>
        </div>

        {/* Branch Selection Section */}
        {isAdmin ? (
          <div className="export-category-block" style={{ background: '#fff', border: '1px solid #d0ded8' }}>
            <div className="export-category-header">
              <span>
                เลือกสาขาที่ต้องการ Export:{' '}
                <span className="fine" style={{ fontWeight: 500 }}>
                  (เลือกแล้ว {selectedBranches.length} จาก {branchOptions.length} สาขา)
                </span>
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="quick-date-btn"
                  onClick={handleSelectAllBranches}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <CheckSquare size={13} /> เลือกทุกสาขา
                </button>
                <button
                  type="button"
                  className="quick-date-btn clear-btn"
                  onClick={handleClearAllBranches}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Square size={13} /> ล้างทั้งหมด
                </button>
              </div>
            </div>
            <div className="export-columns-grid">
              {branchOptions.map((b) => {
                const isChecked = selectedBranches.includes(b.code);
                return (
                  <label key={b.code} className="export-column-item">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleBranch(b.code)}
                    />
                    <span>
                      <strong>{b.code}</strong> {b.name ? `(${b.name})` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="export-category-block" style={{ background: '#f8faf9' }}>
            <div className="export-category-header">
              <span>สาขาที่ต้องการ Export:</span>
            </div>
            <label className="export-column-item" style={{ cursor: 'default' }}>
              <input type="checkbox" checked disabled />
              <span>
                <strong>{sessions[0]?.branchCode || 'สาขาตนเอง'}</strong>{' '}
                {sessions[0]?.branchName ? `(${sessions[0].branchName})` : ''}{' '}
                <span className="fine" style={{ color: '#006663', fontWeight: 600 }}>
                  — สาขาของคุณ
                </span>
              </span>
            </label>
          </div>
        )}

        {/* Column selection toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <strong style={{ fontSize: '13px', color: '#0d3b39' }}>เลือกคอลัมน์ที่ต้องการ Export:</strong>{' '}
            <span className="fine">
              (เลือกแล้ว {selectedColumns.length} จาก {ALL_COLUMN_KEYS.length} คอลัมน์)
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="quick-date-btn"
              onClick={handleSelectAllColumns}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <CheckSquare size={13} /> เลือกทั้งหมด
            </button>
            <button
              type="button"
              className="quick-date-btn clear-btn"
              onClick={handleClearAllColumns}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <Square size={13} /> ล้างทั้งหมด
            </button>
          </div>
        </div>

        {/* Categories of columns */}
        <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
          {EXPORT_CATEGORIES.map((cat) => (
            <div key={cat.category} className="export-category-block">
              <div className="export-category-header">{cat.category}</div>
              <div className="export-columns-grid">
                {cat.columns.map((col) => {
                  const isChecked = selectedColumns.includes(col.key);
                  return (
                    <label key={col.key} className="export-column-item">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleColumn(col.key)}
                      />
                      <span>{col.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Notice>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.4 }}>
            <Info size={16} color="#0abab5" style={{ flexShrink: 0 }} />
            <span>
              ไฟล์จะถูกบันทึกเป็น <strong>CSV (UTF-8 with BOM)</strong> ในรูปแบบวันที่-เวลา <code>YYYY-MM-DD HH:mm:ss</code> รองรับการคำนวณและเปิดใน <strong>Microsoft Excel</strong> โดยภาษาไทยไม่เพี้ยน
            </span>
          </span>
        </Notice>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={handleExport}>
            <Download size={15} style={{ marginRight: '6px' }} />
            ดาวน์โหลดไฟล์ CSV
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SessionLogsWorkspace({
  user,
  sessions,
}: SessionLogsWorkspaceProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState<PageSize>(15);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const isAdmin = user.roles.includes('ADMIN');
  const isManager = user.roles.includes('MANAGER');
  const canExport = isAdmin || isManager;

  // Branch scoping: Only ADMIN sees across all branches. Others are strictly scoped to user's branch.
  const branchScopedSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (isAdmin) return true;
      return (
        s.branchCode === (user.branchCode ?? '') ||
        (user.branchCode && s.branchCode === user.branchCode) ||
        (user.branch && s.branchName === user.branch)
      );
    });
  }, [sessions, isAdmin, user.branchCode, user.branch]);

  // Extract unique branch codes & names for Admin filter
  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    branchScopedSessions.forEach((s) => {
      if (s.branchCode) {
        map.set(s.branchCode, s.branchName || '');
      }
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [branchScopedSessions]);

  // Base filtered sessions (filtered by Branch, Date range, and Search query - before applying Status tab filter)
  const baseFilteredSessions = useMemo(() => {
    return branchScopedSessions.filter((s) => {
      // Branch filter (Admin only)
      if (isAdmin && selectedBranch !== 'ALL') {
        const matchBranch =
          s.branchCode === selectedBranch || s.branchName === selectedBranch;
        if (!matchBranch) return false;
      }

      // Date range filter
      if (startDate) {
        const walkIn = s.timestamps.customer_walk_in_at;
        if (!walkIn) return false;
        if (new Date(walkIn) < new Date(`${startDate}T00:00:00`)) return false;
      }
      if (endDate) {
        const walkIn = s.timestamps.customer_walk_in_at;
        if (!walkIn) return false;
        if (new Date(walkIn) > new Date(`${endDate}T23:59:59.999`)) return false;
      }

      // Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchRef = s.reference.toLowerCase().includes(q);
        const matchPhone = s.phone?.toLowerCase().includes(q) || false;
        const matchStaff = s.staffId?.toLowerCase().includes(q) || false;
        const matchProduct =
          s.selection?.product?.model?.toLowerCase().includes(q) ||
          s.selection?.product?.product?.toLowerCase().includes(q) ||
          s.selection?.product?.sku?.toLowerCase().includes(q) ||
          false;
        const matchBranch =
          s.branchCode?.toLowerCase().includes(q) ||
          s.branchName?.toLowerCase().includes(q) ||
          false;
        return (
          matchRef ||
          matchPhone ||
          matchStaff ||
          matchProduct ||
          matchBranch
        );
      }

      return true;
    });
  }, [
    branchScopedSessions,
    isAdmin,
    selectedBranch,
    startDate,
    endDate,
    search,
  ]);

  // Apply Status tab filter & sorting
  const filteredSessions = useMemo(() => {
    return baseFilteredSessions
      .filter((s) => {
        // Status filter
        if (statusFilter === 'ACTIVE') {
          if (s.outcome || s.state === 'COMPLETED') return false;
        } else if (statusFilter === 'COMPLETED') {
          if (s.state !== 'COMPLETED' || s.outcome) return false;
        } else if (statusFilter === 'NOT_BUY') {
          if (s.outcome !== 'NOT_BUY') return false;
        } else if (statusFilter === 'OUT_OF_STOCK') {
          if (s.outcome !== 'OUT_OF_STOCK') return false;
        } else if (statusFilter === 'CANCELLED') {
          if (s.outcome !== 'CUSTOMER_CANCELLED') return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort newest first
        const timeA = a.timestamps.customer_walk_in_at
          ? new Date(a.timestamps.customer_walk_in_at).getTime()
          : 0;
        const timeB = b.timestamps.customer_walk_in_at
          ? new Date(b.timestamps.customer_walk_in_at).getTime()
          : 0;
        return timeB - timeA;
      });
  }, [
    baseFilteredSessions,
    statusFilter,
  ]);

  // Pagination calculation
  const totalItems = filteredSessions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedSessions = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredSessions.slice(start, start + pageSize);
  }, [filteredSessions, safePage, pageSize]);

  // Selected session for Detail View
  const selectedSession = useMemo(() => {
    if (!selectedRef) return null;
    return branchScopedSessions.find((s) => s.reference === selectedRef) || null;
  }, [branchScopedSessions, selectedRef]);

  // Quick Date Handlers
  const handleSetToday = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    setStartDate(todayStr);
    setEndDate(todayStr);
    setCurrentPage(1);
  };

  // Reset all filters handler
  const handleClearAllFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setSelectedBranch('ALL');
    setStatusFilter('ALL');
    setCurrentPage(1);
  };

  // Stats calculation based on baseFilteredSessions (dynamic according to active date, branch, and search filters)
  const totalCount = baseFilteredSessions.length;
  const activeCount = baseFilteredSessions.filter(
    (s) => !s.outcome && s.state !== 'COMPLETED',
  ).length;
  const completedCount = baseFilteredSessions.filter(
    (s) => s.state === 'COMPLETED' && !s.outcome,
  ).length;
  const notBuyCount = baseFilteredSessions.filter(
    (s) => s.outcome === 'NOT_BUY',
  ).length;
  const outOfStockCount = baseFilteredSessions.filter(
    (s) => s.outcome === 'OUT_OF_STOCK',
  ).length;
  const cancelledCount = baseFilteredSessions.filter(
    (s) => s.outcome === 'CUSTOMER_CANCELLED',
  ).length;

  // If a session is selected, render the Full-page Detail View
  if (selectedRef) {
    return (
      <div className="session-logs-workspace">
        <div className="back-nav-bar">
          <button
            type="button"
            className="back-btn"
            onClick={() => setSelectedRef(null)}
          >
            <ArrowLeft size={16} /> กลับไปหน้ารายการตาราง
          </button>
        </div>

        {selectedSession ? (
          <Panel
            title={`Session: ${selectedSession.reference}`}
            eyebrow={`สาขา ${selectedSession.branchCode}${selectedSession.branchName ? ` (${selectedSession.branchName})` : ''} · สถานะ: ${selectedSession.outcome ?? selectedSession.state}`}
          >
            <div
              className="detail-status-banner"
              style={{ marginBottom: '1.25rem' }}
            >
              <Notice>
                สถานะปัจจุบัน:{' '}
                <strong>
                  {selectedSession.outcome ?? selectedSession.state}
                </strong>
                {selectedSession.phone &&
                  ` · เบอร์โทรลูกค้า: ${selectedSession.phone}`}
                {` · ผู้ดูแล: ${selectedSession.staffId}`}
                {` · สาขา: ${selectedSession.branchCode}${selectedSession.branchName ? ` (${selectedSession.branchName})` : ''}`}
              </Notice>
            </div>

            {/* Event Timeline */}
            <div
              className="session-timeline-section"
              style={{ marginBottom: '1.5rem' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '4px',
                }}
              >
                <Clock size={18} color="#0abab5" />
                <h3 style={{ margin: 0 }}>ลำดับเหตุการณ์และ Event Audit Log</h3>
              </div>
              <p
                className="muted"
                style={{ fontSize: '0.9rem', marginBottom: '1rem' }}
              >
                บันทึกกิจกรรม Server Timestamp และผู้ดำเนินการ (Actor Staff ID)
                แบบเรียลไทม์
              </p>

              {selectedSession.events && selectedSession.events.length > 0 ? (
                <ol className="timeline" style={{ paddingLeft: '0.5rem' }}>
                  {selectedSession.events.map((evt) => (
                    <li
                      key={evt.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <div>
                        <strong>{evt.eventType}</strong>
                        <span
                          style={{
                            marginLeft: '0.5rem',
                            fontSize: '0.85rem',
                            color: '#64748b',
                          }}
                        >
                          โดย Staff: {evt.actorStaffId}
                        </span>
                      </div>
                      <time
                        dateTime={evt.createdAt}
                        style={{ color: '#0f172a', fontWeight: '500' }}
                      >
                        {new Date(evt.createdAt).toLocaleString('th-TH')}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="timeline">
                  {Object.entries(selectedSession.timestamps).map(
                    ([k, time]) => (
                      <li key={k}>
                        <span>{k}</span>
                        <time dateTime={time}>
                          {time
                            ? new Date(time).toLocaleString('th-TH')
                            : '—'}
                        </time>
                      </li>
                    ),
                  )}
                </ol>
              )}
            </div>

            {/* Reason Form Info if Terminal */}
            {(selectedSession.reason ||
              selectedSession.otherReason ||
              selectedSession.cancelledBy) && (
              <div
                className="terminal-reason-box"
                style={{
                  padding: '1rem',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  marginBottom: '1.5rem',
                }}
              >
                <h4>ข้อมูลการสิ้นสุด / ยกเลิก</h4>
                {selectedSession.reason && (
                  <p>
                    <strong>เหตุผล:</strong> {selectedSession.reason}
                  </p>
                )}
                {selectedSession.otherReason && (
                  <p>
                    <strong>รายละเอียดเพิ่มเติม:</strong>{' '}
                    {selectedSession.otherReason}
                  </p>
                )}
                {selectedSession.cancelledBy && (
                  <p>
                    <strong>ผู้บันทึกยกเลิก:</strong>{' '}
                    {selectedSession.cancelledBy}
                  </p>
                )}
              </div>
            )}

            {/* Order & Payment Summary */}
            <div className="session-summary-section">
              <Summary session={selectedSession} />
            </div>
          </Panel>
        ) : (
          <Panel title="ไม่พบรายการ Session" eyebrow="NOT FOUND">
            <p className="muted">
              ไม่พบข้อมูล Session ที่เลือก หรือรายการนี้ถูกลบแล้ว
            </p>
          </Panel>
        )}
      </div>
    );
  }

  // Otherwise, render the Full-width Table View
  const startRowIndex = (safePage - 1) * pageSize;
  const endRowIndex = Math.min(startRowIndex + pageSize, totalItems);

  return (
    <div className="session-logs-workspace">
      {/* Export Modal */}
      {canExport && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          sessions={branchScopedSessions}
          isAdmin={isAdmin}
          branchOptions={branchOptions}
          initialStartDate={startDate}
          initialEndDate={endDate}
          initialBranch={selectedBranch}
        />
      )}

      {/* Header Bar */}
      <div className="workspace-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ClipboardList size={26} color="#0abab5" />
          <div>
            <h2 style={{ margin: 0 }}>
              ประวัติการทำรายการ
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              ตรวจสอบประวัติการบริการ · {isAdmin ? 'ทุกสาขา' : `สาขา ${user.branch}`}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: '1 1 auto', justifyContent: 'flex-end' }}>
          <div className="stats-pills">
            <span className="stat-badge pending">กำลังบริการ: {activeCount}</span>
            <span className="stat-badge ready">สำเร็จ: {completedCount}</span>
            <span
              className="stat-badge"
              style={{ background: '#fef3c7', color: '#92400e' }}
            >
              ไม่ซื้อ: {notBuyCount}
            </span>
            <span
              className="stat-badge"
              style={{ background: '#fee2e2', color: '#991b1b' }}
            >
              ยกเลิก/หมด: {outOfStockCount + cancelledCount}
            </span>
          </div>

          {canExport && (
            <button
              type="button"
              className="button primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '13px',
                marginLeft: 'auto',
              }}
              onClick={() => setIsExportModalOpen(true)}
            >
              <Download size={15} /> Export ข้อมูล
            </button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="logs-toolbar">
        <div className="logs-filters-row">
          {/* Search Input */}
          <div className="logs-search-wrap">
            <input
              type="search"
              placeholder="ค้นหา Session Ref, เบอร์โทรลูกค้า, ผู้ดูแล, สินค้า..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {/* Date Range Picker with Quick button */}
          <div className="logs-date-range-wrap">
            <span style={{ fontSize: '12px', color: '#4b665c' }}>วันที่:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setCurrentPage(1);
              }}
              title="จากวันที่"
            />
            <span style={{ fontSize: '12px', color: '#8fa49a' }}>—</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setCurrentPage(1);
              }}
              title="ถึงวันที่"
            />
            <button
              type="button"
              className="quick-date-btn"
              onClick={handleSetToday}
            >
              วันนี้
            </button>
          </div>

          {/* Admin Branch Selector */}
          {isAdmin && branchOptions.length > 0 && (
            <div className="logs-select-wrap" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={selectedBranch}
                onChange={(e) => {
                  setSelectedBranch(e.target.value);
                  setCurrentPage(1);
                }}
              >
                <option value="ALL">ทุกสาขา</option>
                {branchOptions.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Status Tabs and Clear Filters Button Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {/* Status Tabs */}
          <div
            className="status-filter-tabs"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}
          >
            {(
              [
                'ALL',
                'ACTIVE',
                'COMPLETED',
                'NOT_BUY',
                'OUT_OF_STOCK',
                'CANCELLED',
              ] as StatusFilter[]
            ).map((f) => (
              <button
                key={f}
                type="button"
                className={`tab-btn ${statusFilter === f ? 'active' : ''}`}
                style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
                onClick={() => {
                  setStatusFilter(f);
                  setCurrentPage(1);
                }}
              >
                {f === 'ALL' && `ทั้งหมด (${totalCount})`}
                {f === 'ACTIVE' && `กำลังบริการ (${activeCount})`}
                {f === 'COMPLETED' && `สำเร็จ (${completedCount})`}
                {f === 'NOT_BUY' && `ไม่ซื้อ (${notBuyCount})`}
                {f === 'OUT_OF_STOCK' && `สินค้าหมด (${outOfStockCount})`}
                {f === 'CANCELLED' && `ยกเลิก (${cancelledCount})`}
              </button>
            ))}
          </div>

          {/* Clear Filters Button (Bottom Right) */}
          <button
            type="button"
            className="quick-date-btn clear-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
            }}
            onClick={handleClearAllFilters}
            title="ล้างตัวกรองทั้งหมด"
          >
            <RotateCcw size={13} /> ล้างตัวกรอง
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="table-responsive desktop-logs-table-view">
        <table className="logs-table">
          <thead>
            <tr>
              <th style={{ width: '150px' }}>Session Ref</th>
              <th style={{ width: '120px' }}>เบอร์ลูกค้า</th>
              <th>รายการล่าสุด</th>
              <th style={{ width: '170px' }}>สถานะ</th>
              <th style={{ width: '110px' }}>ผู้ดูแล</th>
              {isAdmin && <th style={{ width: '100px' }}>สาขา</th>}
              <th style={{ width: '130px' }}>เวลา</th>
              <th style={{ width: '110px', textAlign: 'center' }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {paginatedSessions.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 8 : 7}
                  style={{ textAlign: 'center', padding: '40px 20px' }}
                >
                  <div className="empty-state" style={{ border: 'none', background: 'transparent' }}>
                    <ClipboardList
                      size={36}
                      color="#0abab5"
                      style={{ marginBottom: '8px' }}
                    />
                    <p style={{ margin: 0, fontWeight: 500 }}>
                      ไม่พบรายการ Session ที่ตรงกับเงื่อนไขการค้นหา
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedSessions.map((s) => (
                <tr
                  key={s.reference}
                  className="clickable-row"
                  onClick={() => setSelectedRef(s.reference)}
                >
                  <td>
                    <span className="logs-table-ref">{s.reference}</span>
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: s.phone ? '#103836' : '#94a3b8',
                      }}
                    >
                      <Phone size={13} /> {s.phone || '—'}
                    </span>
                  </td>
                  <td>
                    <strong>{getLatestItemText(s)}</strong>
                    {s.selection?.product?.sku && (
                      <span className="card-sku" style={{ display: 'block', marginTop: '2px' }}>
                        SKU: {s.selection.product.sku}
                      </span>
                    )}
                  </td>
                  <td>{renderStatusTag(s)}</td>
                  <td>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontWeight: 500,
                      }}
                    >
                      <UserIcon size={13} /> {s.staffId}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                          color: '#006663',
                        }}
                        title={s.branchName}
                      >
                        <Building2 size={13} /> {s.branchCode}
                      </span>
                    </td>
                  )}
                  <td>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        color: '#64748b',
                      }}
                    >
                      {formatWalkInTime(s.timestamps.customer_walk_in_at)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="button secondary"
                      style={{
                        minWidth: '108px',
                        padding: '5px 10px',
                        fontSize: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRef(s.reference);
                      }}
                    >
                      <Eye size={13} /> ดูรายละเอียด
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List View */}
      <div className="mobile-logs-cards-view">
        {paginatedSessions.length === 0 ? (
          <div className="empty-state" style={{ border: 'none', background: '#fff', borderRadius: '12px', padding: '30px 16px' }}>
            <ClipboardList size={36} color="#0abab5" style={{ marginBottom: '8px' }} />
            <p style={{ margin: 0, fontWeight: 500 }}>
              ไม่พบรายการ Session ที่ตรงกับเงื่อนไขการค้นหา
            </p>
          </div>
        ) : (
          paginatedSessions.map((s) => (
            <div
              key={s.reference}
              className="mobile-log-card"
              onClick={() => setSelectedRef(s.reference)}
            >
              <div className="card-top">
                <span className="card-ref">{s.reference}</span>
                {renderStatusTag(s)}
              </div>
              <div className="mobile-log-product">
                <strong style={{ fontSize: '14px', color: '#103836' }}>{getLatestItemText(s)}</strong>
                {s.selection?.product?.sku && (
                  <span className="card-sku" style={{ marginTop: '2px' }}>SKU: {s.selection.product.sku}</span>
                )}
              </div>
              <div className="mobile-log-meta">
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Phone size={12} /> {s.phone || 'ไม่มีเบอร์'}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <UserIcon size={12} /> {s.staffId}
                  </span>
                  {isAdmin && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#006663', fontWeight: 600 }}>
                      <Building2 size={12} /> {s.branchCode}
                    </span>
                  )}
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#64748b' }}>
                  <Clock size={12} /> {formatWalkInTime(s.timestamps.customer_walk_in_at)}
                </span>
              </div>
              <button
                type="button"
                className="button secondary"
                style={{ width: '100%', marginTop: '6px', minHeight: '38px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRef(s.reference);
                }}
              >
                <Eye size={14} /> ดูรายละเอียด & Timeline
              </button>
            </div>
          ))
        )}
      </div>

      {/* Pagination Bar */}
        {totalItems > 0 && (
          <div className="logs-pagination-bar">
            <div>
              แสดง <strong>{startRowIndex + 1}</strong> -{' '}
              <strong>{endRowIndex}</strong> จาก{' '}
              <strong>{totalItems}</strong> รายการ
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="fine">แสดงแถวต่อหน้า:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as PageSize);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: 'auto',
                    margin: 0,
                    padding: '4px 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="logs-pagination-controls">
                <button
                  type="button"
                  className="page-btn"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage(1)}
                  title="หน้าแรก"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  type="button"
                  className="page-btn"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  title="หน้าก่อนหน้า"
                >
                  <ChevronLeft size={14} />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    // Show current page, first, last, and immediate neighbors
                    return (
                      p === 1 ||
                      p === totalPages ||
                      Math.abs(p - safePage) <= 1
                    );
                  })
                  .map((p, idx, arr) => {
                    const prevP = arr[idx - 1];
                    const showEllipsis = prevP && p - prevP > 1;
                    return (
                      <span
                        key={p}
                        style={{ display: 'inline-flex', alignItems: 'center' }}
                      >
                        {showEllipsis && (
                          <span
                            style={{ padding: '0 4px', color: '#8fa49a' }}
                          >
                            …
                          </span>
                        )}
                        <button
                          type="button"
                          className={`page-btn ${safePage === p ? 'active' : ''}`}
                          onClick={() => setCurrentPage(p)}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}

                <button
                  type="button"
                  className="page-btn"
                  disabled={safePage >= totalPages}
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  title="หน้าถัดไป"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="page-btn"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  title="หน้าสุดท้าย"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
