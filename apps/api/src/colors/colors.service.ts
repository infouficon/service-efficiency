import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { colorOf } from '../warroom/warroom-sync.service';

export interface ColorSkuInfoDto {
  sku: string;
  name: string;
}

export interface ColorItemDto {
  id: string | null;
  name: string;
  hexCode: string;
  skuCount: number;
  skus?: ColorSkuInfoDto[];
}

/**
 * Extract or parse color name from SKU record, attributes, or product name.
 * Harmonized with frontend catalog.ts getSkuAttribute logic.
 */
function extractSkuColor(s: {
  sku: string;
  name: string | null;
  color: string | null;
  attributes: unknown;
}): string | null {
  // 1. Explicit color column
  if (s.color && s.color.trim()) {
    const raw = s.color.trim();
    return colorOf(raw) || raw;
  }

  // 2. attributes.color (JSON)
  if (s.attributes && typeof s.attributes === 'object') {
    const attrColor = (s.attributes as Record<string, unknown>).color;
    if (typeof attrColor === 'string' && attrColor.trim()) {
      const raw = attrColor.trim();
      return colorOf(raw) || raw;
    }
  }

  // 3. Fallback: Parse from product / SKU name (accessories like Cases, Straps, Sleeves)
  if (s.name && s.name.trim()) {
    const rawName = s.name.trim();
    const parts = rawName.split(/[-–—]/);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].replace(/\([^)]*\)/g, '').trim();
      if (
        candidate &&
        !/^\d+\s*(?:w|watt|gb|tb|m|cm|mm)$/i.test(candidate) &&
        candidate.length <= 40
      ) {
        return colorOf(candidate) || candidate;
      }
    }

    const parenMatch = rawName.match(/\(([^)]+)\)$/);
    if (parenMatch && !/\b\d+\s*(?:m|cm|gb|tb|w|mm)\b/i.test(parenMatch[1])) {
      const candidate = parenMatch[1].trim();
      if (candidate.length <= 40) {
        return colorOf(candidate) || candidate;
      }
    }

    const knownColorMatch = rawName.match(
      /\b(Black|White|Stone|Light Blue|Dark Grey|Dark Gray|Sierra Blue|Midnight|Starlight|Pink|Red|Yellow|Green|Blue|Purple|Orange|Silver|Space Gray|Space Grey|Space Black|Natural Titanium|Desert Titanium|Teal|Ultramarine|Saddle Brown|Cypress|Plum|Denim|Star Fruit|Lake Green)\b/i,
    );
    if (knownColorMatch) {
      const candidate = knownColorMatch[1].trim();
      return colorOf(candidate) || candidate;
    }
  }

  return null;
}

@Injectable()
export class ColorsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all product colors: combines defined ProductColor rows with distinct colors found on SKUs (both main devices and accessories) */
  async list(): Promise<ColorItemDto[]> {
    const definedColors = await this.prisma.productColor.findMany({
      orderBy: { name: 'asc' },
    });

    const skus = await this.prisma.productSku.findMany({
      select: { sku: true, name: true, color: true, attributes: true },
    });

    const skuMap = new Map<string, ColorSkuInfoDto[]>();
    for (const s of skus) {
      const c = extractSkuColor(s);
      if (c) {
        const list = skuMap.get(c) ?? [];
        list.push({ sku: s.sku, name: s.name || '' });
        skuMap.set(c, list);
      }
    }

    const definedMap = new Map<string, { id: string; hexCode: string }>();
    for (const dc of definedColors) {
      const cleanName = colorOf(dc.name) || dc.name;
      if (!definedMap.has(cleanName) || dc.hexCode) {
        definedMap.set(cleanName, { id: dc.id, hexCode: dc.hexCode });
      }
    }

    const allNames = new Set<string>([...definedMap.keys(), ...skuMap.keys()]);
    const result: ColorItemDto[] = Array.from(allNames).map((name) => {
      const def = definedMap.get(name);
      const skuList = skuMap.get(name) ?? [];
      return {
        id: def?.id ?? null,
        name,
        hexCode: def?.hexCode ?? '',
        skuCount: skuList.length,
        skus: skuList,
      };
    });

    result.sort((a, b) => {
      if (b.skuCount !== a.skuCount) return b.skuCount - a.skuCount;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  /** Upsert a color mapping: sets the hexCode for a color name */
  async upsert(name: string, hexCode: string) {
    const trimmedName = name.trim();
    const trimmedHex = hexCode.trim();
    return this.prisma.productColor.upsert({
      where: { name: trimmedName },
      create: {
        name: trimmedName,
        hexCode: trimmedHex,
      },
      update: {
        hexCode: trimmedHex,
      },
    });
  }

  /** Delete a color configuration by id */
  async delete(id: string) {
    try {
      return await this.prisma.productColor.delete({
        where: { id },
      });
    } catch {
      throw new NotFoundException('Color not found');
    }
  }

  /** Return a map of color name -> hexCode */
  async getColorMap(): Promise<Record<string, string>> {
    const colors = await this.prisma.productColor.findMany();
    const map: Record<string, string> = {};
    for (const c of colors) {
      map[c.name] = c.hexCode;
      map[c.name.trim().toLowerCase()] = c.hexCode;
      const cleanName = colorOf(c.name);
      if (cleanName) {
        map[cleanName] = c.hexCode;
        map[cleanName.trim().toLowerCase()] = c.hexCode;
      }
    }
    return map;
  }
}
