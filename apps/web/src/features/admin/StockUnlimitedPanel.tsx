import { useEffect, useState } from 'react';
import { PackageCheck, PackageX } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  fetchSettingsApi,
  saveStockUnlimitedApi,
} from '../../services/sessionApi';
import type { AppSettings } from '../../types/session';

/** The current "stock unlimited" switch (D59); null until it has loaded or when it cannot be read. */
function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetchSettingsApi()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error ? err.message : 'โหลดการตั้งค่าไม่สำเร็จ',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return { settings, setSettings, error };
}

/** ADMIN: turns "stock unlimited" on or off. On until the owner turns it off (D59). */
export function StockUnlimitedPanel() {
  const toast = useToast();
  const { settings, setSettings, error } = useSettings();
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = async (value: boolean) => {
    setBusy(true);
    try {
      setSettings(await saveStockUnlimitedApi(value));
      setConfirmOff(false);
      toast.success(
        value ? 'เปิดโหมด Stock ไม่จำกัดแล้ว' : 'ปิดโหมด Stock ไม่จำกัดแล้ว',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel title="Stock ไม่จำกัด (ชั่วคราว)">
        {error && <Notice error>{error}</Notice>}
        {settings && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <span
                className={`status-tag ${settings.stockUnlimited ? 'status-found' : 'status-outcome'}`}
              >
                {settings.stockUnlimited ? 'เปิดอยู่' : 'ปิดอยู่'}
              </span>
              {settings.stockUnlimited ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmOff(true)}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <PackageX size={16} />
                    ปิดโหมดไม่จำกัด
                  </span>
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void change(true)}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <PackageCheck size={16} />
                    เปิดโหมดไม่จำกัด
                  </span>
                </Button>
              )}
            </div>
            <p className="muted">
              {settings.stockUnlimited
                ? 'พนักงานกดเลือกสินค้าได้ทุกรายการแม้ Stock เป็น 0 การหยิบสินค้า (FOUND) ไม่ตัด Stock และการยกเลิกไม่คืน Stock ตัวเลขจาก ERP/warroom ยังเก็บไว้แต่ไม่ใช้ห้ามเลือกสินค้า ปิดสวิตช์นี้เมื่อข้อมูล Stock พร้อมใช้งานจริง'
                : 'สินค้าที่ Stock เป็น 0 กดเลือกไม่ได้ และการหยิบสินค้า (FOUND) ตัด Stock 1 ชิ้น (กฎ D41/D52)'}
            </p>
            {settings.updatedBy && (
              <p className="fine">
                เปลี่ยนล่าสุดโดย {settings.updatedBy}
                {settings.updatedAt
                  ? ` เมื่อ ${new Date(settings.updatedAt).toLocaleString('th-TH')}`
                  : ''}
              </p>
            )}
          </>
        )}
      </Panel>
      {confirmOff && (
        <Modal
          title="ปิดโหมด Stock ไม่จำกัด"
          isOpen
          onClose={() => setConfirmOff(false)}
        >
          <Notice>
            หลังปิด สินค้าที่ Stock เป็น 0 จะกดเลือกไม่ได้ทันที และ FOUND จะตัด
            Stock จริง ตรวจสอบว่า Stock ของสาขาถูกต้องแล้ว
          </Notice>
          <div className="actions">
            <Button disabled={busy} onClick={() => void change(false)}>
              ยืนยันปิดโหมด
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmOff(false)}
            >
              ยกเลิก
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Everybody: a one-line reminder on the product pages while stock numbers are not used to block anything (D59). */
export function StockUnlimitedBanner() {
  const { settings } = useSettings();
  if (!settings?.stockUnlimited) return null;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <Notice>
        โหมด Stock ไม่จำกัด เปิดอยู่: ตัวเลข Stock
        ด้านล่างไม่ถูกใช้ห้ามเลือกสินค้า (ADMIN ปิดได้ที่ จัดการระบบ → ซิงก์
        ERP)
      </Notice>
    </div>
  );
}
