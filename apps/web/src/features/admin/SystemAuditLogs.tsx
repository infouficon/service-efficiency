import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Search,
  RotateCw,
  Calendar,
  Filter,
  CheckCircle2,
  AlertTriangle,
  LogIn,
  Layers,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { fetchAuditLogsApi, type AuditLogItem } from '../../services/sessionApi';

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SystemAuditLogs() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'WORKFLOW' | 'STOCK' | 'ALERT' | 'AUTH'>('ALL');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAuditLogsApi(300);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลประวัติการทำงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Extract branch options from logs
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.branchName && l.branchName !== '-') set.add(l.branchName);
    }
    return Array.from(set).sort();
  }, [logs]);

  const handleSetToday = () => {
    const today = getTodayString();
    setStartDate(today);
    setEndDate(today);
  };

  const handleClearAllFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setSelectedBranch('ALL');
    setCategoryFilter('ALL');
  };

  // Base filtered logs (filtered by search, date range, branch)
  const baseFilteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();

    return logs.filter((item) => {
      // Branch filter
      if (selectedBranch !== 'ALL' && item.branchName !== selectedBranch) {
        return false;
      }

      // Date range filter
      const itemDate = item.timestamp.slice(0, 10);
      if (startDate && itemDate < startDate) return false;
      if (endDate && itemDate > endDate) return false;

      // Search query
      if (q) {
        const matchStaff =
          item.actorStaffId.toLowerCase().includes(q) ||
          item.actorName.toLowerCase().includes(q);
        const matchSession =
          (item.sessionQueue?.toLowerCase().includes(q) ?? false) ||
          (item.sessionReference?.toLowerCase().includes(q) ?? false);
        const matchAction =
          item.action.toLowerCase().includes(q) ||
          item.actionLabel.toLowerCase().includes(q);
        const matchBranch = item.branchName.toLowerCase().includes(q);
        const matchMetadata = item.metadata
          ? JSON.stringify(item.metadata).toLowerCase().includes(q)
          : false;
        if (
          !matchStaff &&
          !matchSession &&
          !matchAction &&
          !matchBranch &&
          !matchMetadata
        ) {
          return false;
        }
      }

      return true;
    });
  }, [logs, search, startDate, endDate, selectedBranch]);

  // Counts based on baseFilteredLogs
  const totalCount = baseFilteredLogs.length;
  const workflowCount = baseFilteredLogs.filter((l) => l.category === 'WORKFLOW').length;
  const stockCount = baseFilteredLogs.filter((l) => l.category === 'STOCK').length;
  const alertCount = baseFilteredLogs.filter((l) => l.category === 'ALERT').length;
  const authCount = baseFilteredLogs.filter((l) => l.category === 'AUTH').length;

  // Final filtered logs with category tab applied
  const filteredLogs = useMemo(() => {
    if (categoryFilter === 'ALL') return baseFilteredLogs;
    return baseFilteredLogs.filter((l) => l.category === categoryFilter);
  }, [baseFilteredLogs, categoryFilter]);

  const categoryBadge = (category: AuditLogItem['category']) => {
    switch (category) {
      case 'AUTH':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#f5f3ff',
              color: '#7c3aed',
              border: '1px solid #ddd6fe',
            }}
          >
            <LogIn size={11} /> Auth
          </span>
        );
      case 'ALERT':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#fff1f2',
              color: '#e11d48',
              border: '1px solid #fecdd3',
            }}
          >
            <AlertTriangle size={11} /> Alert
          </span>
        );
      case 'STOCK':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#fffbeb',
              color: '#b45309',
              border: '1px solid #fde68a',
            }}
          >
            <Filter size={11} /> Stock
          </span>
        );
      case 'WORKFLOW':
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#eff6ff',
              color: '#2563eb',
              border: '1px solid #bfdbfe',
            }}
          >
            <Layers size={11} /> Workflow
          </span>
        );
    }
  };

  return (
    <Panel title="ประวัติการทำงานของระบบ (System Audit Logs)">
      {error && (
        <Notice error>
          {error}
          <Button variant="secondary" onClick={loadLogs}>
            ลองโหลดใหม่
          </Button>
        </Notice>
      )}

      {/* Filter Toolbar (Matching SessionLogsWorkspace .logs-toolbar) */}
      <div className="logs-toolbar">
        <div className="logs-filters-row">
          {/* Search Input */}
          <div className="logs-search-wrap">
            <input
              type="search"
              placeholder="ค้นหา Staff ID, ชื่อ, คิว, กิจกรรม..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Date Range Picker with Quick Today button */}
          <div className="logs-date-range-wrap">
            <span style={{ fontSize: '12px', color: '#4b665c' }}>วันที่:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              title="จากวันที่"
            />
            <span style={{ fontSize: '12px', color: '#8fa49a' }}>—</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
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

          {/* Branch Selector */}
          {branchOptions.length > 0 && (
            <div className="logs-select-wrap" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                <option value="ALL">ทุกสาขา</option>
                {branchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Refresh Button */}
          <button
            type="button"
            className="quick-date-btn"
            onClick={loadLogs}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            title="รีเฟรชข้อมูล"
          >
            <RotateCw size={13} className={loading ? 'spin' : ''} />
            <span>รีเฟรช</span>
          </button>
        </div>

        {/* Category Tabs and Clear Filters Button Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {/* Category Tabs */}
          <div
            className="status-filter-tabs"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}
          >
            {(
              [
                { id: 'ALL', label: `ทั้งหมด (${totalCount})` },
                { id: 'WORKFLOW', label: `กระบวนการขาย (${workflowCount})` },
                { id: 'STOCK', label: `คลังสินค้า (${stockCount})` },
                { id: 'ALERT', label: `แจ้งเตือน (${alertCount})` },
                { id: 'AUTH', label: `เข้าสู่ระบบ (${authCount})` },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`tab-btn ${categoryFilter === cat.id ? 'active' : ''}`}
                style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
                onClick={() => setCategoryFilter(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Clear Filters Button */}
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

      {/* Audit Log Table */}
      {loading && logs.length === 0 ? (
        <Notice>กำลังโหลดประวัติการทำงานของระบบ…</Notice>
      ) : filteredLogs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          ไม่พบประวัติการทำงานตามเงื่อนไขที่ค้นหา
        </div>
      ) : (
        <div className="table-responsive" style={{ maxHeight: '650px', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="admin-table" style={{ minWidth: '1100px', width: '100%', fontSize: '13px' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
              <tr>
                <th style={{ width: '170px', minWidth: '170px', whiteSpace: 'nowrap' }}>เวลา (Server Time)</th>
                <th style={{ width: '110px', minWidth: '110px', whiteSpace: 'nowrap' }}>หมวดหมู่</th>
                <th style={{ minWidth: '220px' }}>กิจกรรม (Action)</th>
                <th style={{ minWidth: '160px', whiteSpace: 'nowrap' }}>ผู้ดำเนินการ (Actor)</th>
                <th style={{ minWidth: '130px', whiteSpace: 'nowrap' }}>สาขา (Branch)</th>
                <th style={{ width: '120px', minWidth: '120px', whiteSpace: 'nowrap' }}>คิว</th>
                <th style={{ minWidth: '190px' }}>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((item) => {
                const isExpanded = expandedRowId === item.id;
                const hasMetadata = item.metadata && Object.keys(item.metadata).length > 0;

                return (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: 'nowrap', color: '#334155' }}>
                      {formatDateTime(item.timestamp)}
                    </td>
                    <td>{categoryBadge(item.category)}</td>
                    <td>
                      <div>
                        <strong>{item.actionLabel}</strong>
                        <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                          {item.action}
                        </div>
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div>
                        <strong>{item.actorStaffId}</strong>
                        {item.actorName && item.actorName !== item.actorStaffId && (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            {item.actorName}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.branchName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {item.sessionQueue || item.sessionReference ? (
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: '#0f766e',
                            background: '#f0fdf4',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid #bbf7d0',
                          }}
                        >
                          {item.sessionQueue
                            ? `${item.sessionQueue}`
                            : item.sessionReference}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td>
                      {hasMetadata ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setExpandedRowId(isExpanded ? null : item.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                            fontSize: '11px',
                            color: '#2563eb',
                            cursor: 'pointer',
                            background: 'transparent',
                            border: 'none',
                            padding: '2px 4px',
                          }}
                          title="ดู Metadata"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span>{isExpanded ? 'ซ่อน' : 'ดู'}</span>
                        </button>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                      )}
                      {isExpanded && hasMetadata && (
                        <div
                          style={{
                            marginTop: '6px',
                            padding: '8px',
                            background: '#f1f5f9',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            maxWidth: '320px',
                          }}
                        >
                          {JSON.stringify(item.metadata, null, 2)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
