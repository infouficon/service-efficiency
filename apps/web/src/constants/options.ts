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
export const ontop = ['AIS', 'True', 'CATH', 'KTS'] as const;
export const points = ['MCard', 'The 1', 'UJOY'] as const;
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
export const cancelReasons = [
  'ราคา',
  'ยังไม่ตัดสินใจ',
  'เปลี่ยนใจ',
  'สินค้าไม่ตรงความต้องการ',
  'ต้องการสอบถามราคาหรือรายละเอียดเฉยๆ',
  'รอนาน', 
  'อื่น ๆ'
] as const;
export const stages = [
  'Walk-in',
  'DEMO',
  'Decision',
  'Product',
  'Confirmation',
  'Stock',
  'Cashier',
] as const;
export const cancellationStages = [
  'DEMO',
  'PRODUCT_SELECTION',
  'STOCK',
  'CASHIER',
] as const;
