export const categories = ['iPhone', 'iPad', 'Mac', 'Watch', 'Accessories'] as const;
export const deviceCategories = ['iPhone', 'iPad', 'Mac', 'Watch'] as const;
export const accessories = [
  'Apple Pencil',
  'Apple Keyboard',
  'Magic Mouse',
  'Magic Trackpad',
  'Case',
  'Protection',
  'Power & Battery',
  'AirPods & Audio',
  'Adapters & Hubs',
  'Charging',
  'Storage / Connectivity',
  'Headphones & speakers',
  'Apple Care+',
  'iProtect',
  'Software',
] as const;
export const ontop = ['AIS', 'True', 'CATH', 'U Trade'] as const;
export const points = ['MCard', 'The 1', 'UJOY'] as const;
/** The payment types FileMaker knows (D89); the same list as `FMP_PAYMENT_TYPES` in the API (a test keeps them in step). */
export const fmpPaymentTypes = [
  'เงินสด',
  'โอนเงิน',
  'บัตรเครดิต',
  'บัตรเงินผ่อน',
  'ใช้มัดจำ',
  'Trade In',
  'U-Joy',
  'Partner Mall',
  'อื่นๆ',
] as const;
export const payments = [
  'Cash',
  'Transfer',
  'SPayLater',
  'TrueMoney',
  'Full Credit Card',
  '0% Credit Card',
  'PayNext',
  'UFund',
  'Ulite',
  'Thisshop',
  'Kashjoy',
] as const;
export const notBuyReasons = [
  'ราคา',
  'ยังไม่ตัดสินใจ',
  'เปลี่ยนใจ',
  'สินค้าไม่ตรงความต้องการ',
  'ต้องการสอบถามราคาหรือรายละเอียดเฉยๆ',
  'อื่น ๆ',
] as const;
/**
 * F11: cancel reasons for a change of mind about the product itself. A session cancelled with one of them can be bought
 * again ("ซื้อใหม่") with its old data and its old queue number. Keep equal to `CHANGE_REASONS` in the API's sessions.service.ts.
 */
export const changeReasons = [
  'เปลี่ยนรุ่น',
  'เปลี่ยนสี',
  'เปลี่ยนความจุ',
  'พนักงานเลือกสินค้าผิดพลาด',
] as const;
export const cancelReasons = [
  'ราคา',
  'ยังไม่ตัดสินใจ',
  'เปลี่ยนใจ',
  'สินค้าไม่ตรงความต้องการ',
  'ต้องการสอบถามราคาหรือรายละเอียดเฉยๆ',
  ...changeReasons,
  'รอนาน',
  'อื่น ๆ',
] as const;
/** F13: why the cashier sends an order back to stock. */
export const rejectReasons = [
  'หยิบสินค้าผิด',
  'สินค้าชำรุด/มีตำหนิ',
  'อื่น ๆ',
] as const;
export const stages = [
  'กรอกเบอร์โทร',
  'เลือกสินค้า',
  'ตรวจสอบยืนยัน',
  'ฝ่ายคลัง',
  'แคชเชียร์',
] as const;
export const cancellationStages = [
  'DEMO',
  'PRODUCT_SELECTION',
  'STOCK',
  'CASHIER',
] as const;
