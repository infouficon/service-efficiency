import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
 * Detects if a parsed candidate string is NOT a real product color.
 * Filters out: band sizes, storage/RAM, wattages, adapter/cable names,
 * pack sizes, language/region tags, chips, years/dates, leftovers.
 */
export function isNonColor(candidate: string): boolean {
  if (!candidate) return true;
  const s = candidate.trim();
  if (s.length <= 1) return true;
  if (s.replace(/[()[\]{},./\-_:\s]/g, '').length <= 1) return true;

  // Sizes: S/M, M/L, Large, Small, S, M, L, XL, XXL, 40mm, 1m, etc.
  if (/^(?:s\/m|m\/l|xs|s|m|l|xl|xxl|large|small|medium|inch|in|demo|fae)$/i.test(s)) return true;
  if (/^\d+\s*(?:mm|cm|m|inch|in)$/i.test(s)) return true;

  // Storage / Capacity / Memory / Wattage: 256GB, 512GB, 20W, etc.
  if (/^\d+\s*(?:gb|tb|mb|w|watt)$/i.test(s)) return true;

  // Pack counts: 1 Pack, 4 Pack, 4 pack
  if (/^\d+\s*pack$/i.test(s)) return true;

  // Language / Region / Layout: Thai, THA, ENG, US, INT, CI/AR, LL/A, US English, etc.
  if (
    /^(?:us\s+english|uk\s+english|intl?\s+english|thai(?:\s*[\/-]\s*eng(?:lish)?)?|thai|tha|eng|english|us|int|ci\/ar|za\/a|th\/a|ll\/a|japanese|korean|arabic|chinese|russian)$/i.test(
      s,
    )
  )
    return true;

  // Direction / part / channel
  if (/\b(?:left|right|front|back|top|bottom)\b/i.test(s)) return true;

  // Hardware accessories: Adapter, Cable, Charger, Multiport, Headphone Jack, SD Card, etc.
  if (
    /\b(?:adapter|cable|charger|multiport|connector|headphone|jack|reader|thunderbolt|magsafe|lightning|power\s*adapter)\b/i.test(
      s,
    )
  )
    return true;

  // Chips, CPUs, years, dates: A15, A16, A17, A18, M1, M2, M3, M4, Late 2024, 2025), etc.
  if (
    /\b(?:a\d{2}|m[1-4](?:\s*pro|\s*max|\s*ultra)?|late\s*\d{4}|early\s*\d{4}|mid\s*\d{4}|\d{4}\)?)\b/i.test(
      s,
    )
  )
    return true;

  // Product categories, family names, leftovers: MacBook, iPad, iPhone, Watch, Surface, Demo, etc.
  if (
    /\b(?:macbook|imac|mac\s*mini|mac\s*studio|mac\s*pro|ipad|iphone|apple\s*watch|airpods|airtag|pencil|keyboard|mouse|trackpad|touch\s*surface|surface|demo)\b/i.test(
      s,
    )
  )
    return true;

  return false;
}

/**
 * Normalizes color candidates by stripping trailing language/region tokens.
 * e.g. "Citrus Eng" -> "Citrus"
 */
export function normalizeColorName(name: string): string {
  let cleaned = name.trim();
  cleaned = cleaned.replace(/\s+(?:eng|thai|tha|us|int)$/i, '').trim();
  return colorOf(cleaned) || cleaned;
}

/**
 * Extract or parse color name from SKU record, attributes, or product name.
 * Harmonized with frontend catalog.ts getSkuAttribute logic and filtered with isNonColor.
 */
function extractSkuColor(s: {
  sku: string;
  name: string | null;
  color: string | null;
  attributes: unknown;
}): string | null {
  // 1. Explicit color column
  if (s.color && s.color.trim()) {
    const raw = normalizeColorName(s.color.trim());
    if (!isNonColor(raw)) {
      return raw;
    }
  }

  // 2. attributes.color (JSON)
  if (s.attributes && typeof s.attributes === 'object') {
    const attrColor = (s.attributes as Record<string, unknown>).color;
    if (typeof attrColor === 'string' && attrColor.trim()) {
      const raw = normalizeColorName(attrColor.trim());
      if (!isNonColor(raw)) {
        return raw;
      }
    }
  }

  // 3. Fallback: Parse from product / SKU name (accessories like Cases, Straps, Sleeves)
  if (s.name && s.name.trim()) {
    const rawName = s.name.trim();
    const parts = rawName.split(/[-–—]/);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].replace(/\([^)]*\)/g, '').trim();
      const normalized = normalizeColorName(candidate);
      if (
        normalized &&
        !isNonColor(normalized) &&
        normalized.length <= 40
      ) {
        return normalized;
      }
    }

    const parenMatch = rawName.match(/\(([^)]+)\)$/);
    if (parenMatch && !/\b\d+\s*(?:m|cm|gb|tb|w|mm)\b/i.test(parenMatch[1])) {
      const candidate = parenMatch[1].trim();
      const normalized = normalizeColorName(candidate);
      if (normalized && !isNonColor(normalized) && normalized.length <= 40) {
        return normalized;
      }
    }

    const knownColorMatch = rawName.match(
      /\b(Black|White|Stone|Light Blue|Dark Grey|Dark Gray|Sierra Blue|Midnight|Starlight|Pink|Red|Yellow|Green|Blue|Purple|Orange|Silver|Space Gray|Space Grey|Space Black|Natural Titanium|Desert Titanium|Teal|Ultramarine|Saddle Brown|Cypress|Plum|Denim|Star Fruit|Lake Green|Citrus)\b/i,
    );
    if (knownColorMatch) {
      const candidate = knownColorMatch[1].trim();
      const normalized = normalizeColorName(candidate);
      if (!isNonColor(normalized)) {
        return normalized;
      }
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

  /** Search active SKUs by SKU code or product name to bind to a color */
  async searchSkus(
    query: string,
  ): Promise<{ sku: string; name: string; color: string | null }[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.prisma.productSku.findMany({
      where: {
        active: true,
        OR: [{ sku: { contains: q } }, { name: { contains: q } }],
      },
      select: { sku: true, name: true, color: true },
      take: 20,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Bind or unbind a SKU to a color. Sets colorOverride to true to preserve across ERP syncs.
   * If colorName is null or empty, unbinds the SKU.
   */
  async bindSku(skuCode: string, colorName: string | null) {
    const targetSku = await this.prisma.productSku.findUnique({
      where: { sku: skuCode.trim() },
    });
    if (!targetSku) {
      throw new NotFoundException(`SKU "${skuCode}" not found`);
    }

    const trimmedColor = colorName ? colorName.trim() : null;
    const currentAttrs =
      (targetSku.attributes as Record<string, unknown>) || {};
    const nextAttrs = { ...currentAttrs };
    if (trimmedColor) {
      nextAttrs.color = trimmedColor;
    } else {
      delete nextAttrs.color;
    }

    // Auto-create ProductColor if non-existent so it appears in the palette
    if (trimmedColor) {
      await this.prisma.productColor.upsert({
        where: { name: trimmedColor },
        create: { name: trimmedColor, hexCode: '' },
        update: {},
      });
    }

    return this.prisma.productSku.update({
      where: { id: targetSku.id },
      data: {
        color: trimmedColor,
        colorOverride: Boolean(trimmedColor),
        attributes:
          Object.keys(nextAttrs).length > 0
            ? (nextAttrs as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
  }

  /**
   * Move all SKUs from one color to another, or unbind all if toColor is null/empty.
   */
  async migrateSkus(fromColor: string, toColor: string | null) {
    const trimmedFrom = fromColor.trim();
    const trimmedTo = toColor ? toColor.trim() : null;

    if (trimmedTo) {
      await this.prisma.productColor.upsert({
        where: { name: trimmedTo },
        create: { name: trimmedTo, hexCode: '' },
        update: {},
      });
    }

    const matchingSkus = await this.prisma.productSku.findMany({
      where: {
        color: trimmedFrom,
      },
    });

    for (const s of matchingSkus) {
      const currentAttrs = (s.attributes as Record<string, unknown>) || {};
      const nextAttrs = { ...currentAttrs };
      if (trimmedTo) {
        nextAttrs.color = trimmedTo;
      } else {
        delete nextAttrs.color;
      }
      await this.prisma.productSku.update({
        where: { id: s.id },
        data: {
          color: trimmedTo,
          colorOverride: Boolean(trimmedTo),
          attributes:
            Object.keys(nextAttrs).length > 0
              ? (nextAttrs as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      });
    }

    return { migratedCount: matchingSkus.length };
  }

  /** Delete a color configuration by id. Optionally migrates its SKUs or unbinds them. */
  async delete(id: string, migrateToColor?: string | null) {
    const existing = await this.prisma.productColor.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Color not found');
    }

    if (migrateToColor !== undefined) {
      await this.migrateSkus(existing.name, migrateToColor);
    } else {
      await this.migrateSkus(existing.name, null);
    }

    return this.prisma.productColor.delete({
      where: { id },
    });
  }

  /** Return a map of color name -> hexCode (with case-insensitive keys) */
  async getColorMap(): Promise<Record<string, string>> {
    const colors = await this.prisma.productColor.findMany();
    const map: Record<string, string> = {};
    for (const c of colors) {
      const hex = c.hexCode?.trim() || '';
      if (!hex) continue;
      map[c.name] = hex;
      map[c.name.trim().toLowerCase()] = hex;
      const cleanName = colorOf(c.name);
      if (cleanName) {
        map[cleanName] = hex;
        map[cleanName.trim().toLowerCase()] = hex;
      }
    }
    return map;
  }
}
