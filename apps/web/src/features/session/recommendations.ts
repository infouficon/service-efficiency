export interface RecommendationVariant {
  skuCode: string;
  name: string;
  price: number;
}

export interface RecommendationItem {
  id: string;
  category: string;
  brand: string;
  skuCode: string;
  name: string;
  price: number;
  accessoryCategory: string;
  variants: RecommendationVariant[];
}

export interface AdditionalEcosystemItem {
  id: string;
  category: string;
  brand: string;
  skuCode: string;
  name: string;
  price: number;
  accessoryCategory?: string;
  variants: RecommendationVariant[];
}

export type AdditionalItemStatus =
  | 'NONE'
  | 'RECOMMENDED'
  | 'INTERESTED'
  | 'OWNED'
  | 'OLD_MODEL';

export function getMainProductRecommendations(
  productName?: string,
  prefix = 'rec',
): RecommendationItem[] {
  const lower = (productName || '').toLowerCase();

  if (lower.includes('ipad')) {
    return [
      {
        id: `${prefix}-ipad-1`,
        category: 'เคส',
        brand: 'WIWU',
        skuCode: 'SKU-WIWU-FOLIO',
        name: 'Wiwu Defender Smart Folio Case for iPad',
        price: 890,
        accessoryCategory: 'Case',
        variants: [
          { skuCode: 'SKU-WIWU-FOLIO-BLK', name: 'Defender Folio – Midnight Black', price: 890 },
          { skuCode: 'SKU-WIWU-FOLIO-NAV', name: 'Defender Folio – Navy Blue', price: 890 },
          { skuCode: 'SKU-WIWU-FOLIO-PRP', name: 'Defender Folio – Lilac Purple', price: 890 },
          { skuCode: 'SKU-WIWU-FOLIO-MNT', name: 'Defender Folio – Mint Green', price: 890 },
          { skuCode: 'SKU-WIWU-FOLIO-GRY', name: 'Defender Folio – Space Gray', price: 890 },
        ],
      },
      {
        id: `${prefix}-ipad-2`,
        category: 'ฟิล์มกันรอย',
        brand: 'AmazingThing',
        skuCode: 'SKU-AMZ-PAPER',
        name: 'AmazingThing Titan Paper-Like Matte Film for iPad',
        price: 890,
        accessoryCategory: 'Protection',
        variants: [
          { skuCode: 'SKU-AMZ-PAPER-MAT', name: 'Titan Paper-Like Matte Texture', price: 890 },
          { skuCode: 'SKU-AMZ-GLASS-CLR', name: 'Titan 9H Tempered Glass Clear', price: 790 },
          { skuCode: 'SKU-AMZ-GLASS-PRV', name: 'Titan Privacy 2-Way Filter Glass', price: 1090 },
        ],
      },
      {
        id: `${prefix}-ipad-3`,
        category: 'อะแดปเตอร์ชาร์จ',
        brand: 'Apple',
        skuCode: 'SKU-APL-30W',
        name: 'Apple 30W USB-C Power Adapter',
        price: 1390,
        accessoryCategory: 'Power & Battery',
        variants: [
          { skuCode: 'SKU-APL-30W-STD', name: 'Apple 30W USB-C Power Adapter', price: 1390 },
          { skuCode: 'SKU-APL-35W-DUAL', name: 'Apple 35W Dual USB-C Port Compact Adapter', price: 1990 },
          { skuCode: 'SKU-APL-20W-STD', name: 'Apple 20W USB-C Power Adapter', price: 790 },
        ],
      },
    ];
  }

  if (lower.includes('mac') || lower.includes('book')) {
    return [
      {
        id: `${prefix}-mac-1`,
        category: 'ฮับเชื่อมต่อ',
        brand: 'WIWU',
        skuCode: 'SKU-WIWU-HUB7',
        name: 'Wiwu Alpha 7-in-1 Dual USB-C Multiport Hub',
        price: 1490,
        accessoryCategory: 'Adapters & Hubs',
        variants: [
          { skuCode: 'SKU-WIWU-HUB7-GRY', name: 'Alpha 7-in-1 Dual USB-C – Space Gray', price: 1490 },
          { skuCode: 'SKU-WIWU-HUB7-SLV', name: 'Alpha 7-in-1 Dual USB-C – Silver', price: 1490 },
          { skuCode: 'SKU-WIWU-HUB5-MINI', name: 'Alpha 5-in-1 Compact USB-C Hub', price: 1090 },
        ],
      },
      {
        id: `${prefix}-mac-2`,
        category: 'ซองและกระเป๋า',
        brand: 'WIWU',
        skuCode: 'SKU-WIWU-SKIN',
        name: 'Wiwu Skin Pro Vegan Leather Sleeve for MacBook',
        price: 990,
        accessoryCategory: 'Case',
        variants: [
          { skuCode: 'SKU-WIWU-SKIN-BLK', name: 'Skin Pro Sleeve – Pitch Black', price: 990 },
          { skuCode: 'SKU-WIWU-SKIN-BRN', name: 'Skin Pro Sleeve – Saddle Brown', price: 990 },
          { skuCode: 'SKU-WIWU-SKIN-BLU', name: 'Skin Pro Sleeve – Midnight Blue', price: 990 },
        ],
      },
      {
        id: `${prefix}-mac-3`,
        category: 'ฟิล์มหน้าจอ',
        brand: 'AmazingThing',
        skuCode: 'SKU-AMZ-MACCLR',
        name: 'AmazingThing Titan Anti-Glare Magnetic Film for MacBook',
        price: 990,
        accessoryCategory: 'Protection',
        variants: [
          { skuCode: 'SKU-AMZ-MACCLR-AG', name: 'Titan Anti-Glare Magnetic Film', price: 990 },
          { skuCode: 'SKU-AMZ-MACCLR-PRV', name: 'Titan Magnetic Privacy Screen Filter', price: 1390 },
        ],
      },
    ];
  }

  if (lower.includes('watch')) {
    return [
      {
        id: `${prefix}-watch-1`,
        category: 'เคสกันรอย',
        brand: 'AmazingThing',
        skuCode: 'SKU-AMZ-WTC-BMP',
        name: 'AmazingThing Titan Bumper Case with Tempered Glass',
        price: 590,
        accessoryCategory: 'Protection',
        variants: [
          { skuCode: 'SKU-AMZ-WTC-BMP-BLK', name: 'Titan Bumper Case – Matte Black', price: 590 },
          { skuCode: 'SKU-AMZ-WTC-BMP-CLR', name: 'Titan Bumper Case – Crystal Clear', price: 590 },
          { skuCode: 'SKU-AMZ-WTC-BMP-SLV', name: 'Titan Bumper Case – Starlight Silver', price: 590 },
        ],
      },
      {
        id: `${prefix}-watch-2`,
        category: 'สายนาฬิกา',
        brand: 'WIWU',
        skuCode: 'SKU-WIWU-BAND-MAG',
        name: 'Wiwu Magnetic Silicone Sport Loop Band',
        price: 690,
        accessoryCategory: 'Case',
        variants: [
          { skuCode: 'SKU-WIWU-BAND-BLK', name: 'Magnetic Sport Loop – Midnight Black', price: 690 },
          { skuCode: 'SKU-WIWU-BAND-ORG', name: 'Magnetic Sport Loop – Ultra Orange', price: 690 },
          { skuCode: 'SKU-WIWU-BAND-BLU', name: 'Magnetic Sport Loop – Ocean Blue', price: 690 },
        ],
      },
      {
        id: `${prefix}-watch-3`,
        category: 'สายชาร์จเร็ว',
        brand: 'Apple',
        skuCode: 'SKU-APL-WTC-CHG',
        name: 'Apple Watch Magnetic Fast Charger to USB-C Cable (1 m)',
        price: 1190,
        accessoryCategory: 'Power & Battery',
        variants: [
          { skuCode: 'SKU-APL-WTC-CHG-1M', name: 'Apple Watch Magnetic Fast Charger (1m)', price: 1190 },
          { skuCode: 'SKU-APL-WTC-CHG-03M', name: 'Apple Watch Magnetic Fast Charger (0.3m)', price: 1190 },
        ],
      },
    ];
  }

  // Default: iPhone or general device recommendations
  return [
    {
      id: `${prefix}-iphone-1`,
      category: 'เคส',
      brand: 'WIWU',
      skuCode: 'SKU-WIWU-108',
      name: 'Wiwu iShield One ZCC-108 for iPhone – Clear',
      price: 490,
      accessoryCategory: 'Case',
      variants: [
        { skuCode: 'SKU-WIWU-108-CLR', name: 'Wiwu iShield One – Ultra Clear', price: 490 },
        { skuCode: 'SKU-WIWU-108-SMK', name: 'Wiwu iShield One – Smoke Black', price: 490 },
        { skuCode: 'SKU-WIWU-108-BLU', name: 'Wiwu iShield One – Deep Blue', price: 550 },
        { skuCode: 'SKU-WIWU-108-MGS', name: 'Wiwu iShield MagSafe – Matte Clear', price: 690 },
        { skuCode: 'SKU-WIWU-108-PRP', name: 'Wiwu iShield One – Light Purple', price: 490 },
      ],
    },
    {
      id: `${prefix}-iphone-2`,
      category: 'ฟิล์มกระจก',
      brand: 'AmazingThing',
      skuCode: 'SKU-AMZ-TITAN',
      name: 'AmazingThing Titan 2.7D Privacy Tempered Glass',
      price: 790,
      accessoryCategory: 'Protection',
      variants: [
        { skuCode: 'SKU-AMZ-TITAN-PRV', name: 'Titan 2.7D Privacy Tempered Glass', price: 790 },
        { skuCode: 'SKU-AMZ-TITAN-CLR', name: 'Titan 2.7D HD Clear Tempered Glass', price: 690 },
        { skuCode: 'SKU-AMZ-TITAN-MAT', name: 'Titan 2.7D Matte Gaming Glass', price: 790 },
        { skuCode: 'SKU-AMZ-TITAN-BLU', name: 'Titan 2.7D Anti-Blue Light Glass', price: 790 },
      ],
    },
    {
      id: `${prefix}-iphone-3`,
      category: 'อะแดปเตอร์ชาร์จ',
      brand: 'Apple',
      skuCode: 'SKU-APL-20W',
      name: 'Apple 20W USB-C Power Adapter (Fast Charging)',
      price: 790,
      accessoryCategory: 'Power & Battery',
      variants: [
        { skuCode: 'SKU-APL-20W-STD', name: 'Apple 20W USB-C Power Adapter', price: 790 },
        { skuCode: 'SKU-APL-35W-DUAL', name: 'Apple 35W Dual USB-C Compact Adapter', price: 1990 },
        { skuCode: 'SKU-APL-MGS-CHG', name: 'Apple MagSafe Charger (1m cable)', price: 1590 },
      ],
    },
  ];
}

export function getAdditionalEcosystemItems(): AdditionalEcosystemItem[] {
  return [
    {
      id: 'eco-1',
      category: 'หูฟังไร้สาย',
      brand: 'Apple',
      skuCode: 'SKU-APL-AP4ANC',
      name: 'AirPods 4 (Active Noise Cancellation)',
      price: 6490,
      accessoryCategory: 'AirPods & Audio',
      variants: [
        { skuCode: 'SKU-APL-AP4ANC', name: 'AirPods 4 with Active Noise Cancellation', price: 6490 },
        { skuCode: 'SKU-APL-AP4STD', name: 'AirPods 4 Standard', price: 4990 },
        { skuCode: 'SKU-APL-APPRO2', name: 'AirPods Pro 2 (USB-C)', price: 8990 },
        { skuCode: 'SKU-APL-APMAX', name: 'AirPods Max (USB-C)', price: 19900 },
      ],
    },
    {
      id: 'eco-2',
      category: 'สมาร์ทวอทช์',
      brand: 'Apple',
      skuCode: 'SKU-APL-AW10-46',
      name: 'Apple Watch Series 10 (GPS 46mm)',
      price: 15900,
      variants: [
        { skuCode: 'SKU-APL-AW10-46-BLK', name: 'Apple Watch Series 10 (GPS 46mm) Jet Black', price: 15900 },
        { skuCode: 'SKU-APL-AW10-42-RSG', name: 'Apple Watch Series 10 (GPS 42mm) Rose Gold', price: 14900 },
        { skuCode: 'SKU-APL-AW10-CEL', name: 'Apple Watch Series 10 (GPS + Cellular 46mm)', price: 19900 },
        { skuCode: 'SKU-APL-AWULTRA2', name: 'Apple Watch Ultra 2 (GPS + Cellular 49mm)', price: 29900 },
      ],
    },
    {
      id: 'eco-3',
      category: 'แท็บเล็ต',
      brand: 'Apple',
      skuCode: 'SKU-APL-IPADAIR11',
      name: 'iPad Air 11" (M2) 128GB Wi-Fi',
      price: 23900,
      variants: [
        { skuCode: 'SKU-APL-IPADAIR11-128', name: 'iPad Air 11" (M2) 128GB Wi-Fi Space Gray', price: 23900 },
        { skuCode: 'SKU-APL-IPADAIR11-256', name: 'iPad Air 11" (M2) 256GB Wi-Fi Starlight', price: 27900 },
        { skuCode: 'SKU-APL-IPADAIR13-128', name: 'iPad Air 13" (M2) 128GB Wi-Fi Blue', price: 29900 },
        { skuCode: 'SKU-APL-IPAD10-64', name: 'iPad 10th Gen 64GB Wi-Fi Silver', price: 12900 },
      ],
    },
    {
      id: 'eco-4',
      category: 'สไตลัส',
      brand: 'Apple',
      skuCode: 'SKU-APL-PENPRO',
      name: 'Apple Pencil Pro',
      price: 4990,
      accessoryCategory: 'Apple Pencil',
      variants: [
        { skuCode: 'SKU-APL-PENPRO', name: 'Apple Pencil Pro', price: 4990 },
        { skuCode: 'SKU-APL-PENUSBC', name: 'Apple Pencil (USB-C)', price: 3190 },
        { skuCode: 'SKU-APL-PEN2', name: 'Apple Pencil (2nd generation)', price: 4990 },
      ],
    },
  ];
}

/**
 * D153: Fetch product recommendations (currently mock data, ready for API integration).
 */
export async function fetchProductRecommendationsApi(
  _sessionId?: string,
  productModel?: string,
): Promise<{
  mainRecommendations: RecommendationItem[];
  additionalItems: AdditionalEcosystemItem[];
}> {
  return {
    mainRecommendations: getMainProductRecommendations(productModel),
    additionalItems: getAdditionalEcosystemItems(),
  };
}
