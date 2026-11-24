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

@Injectable()
export class ColorsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all product colors: combines defined ProductColor rows with distinct colors found on SKUs */
  async list(): Promise<ColorItemDto[]> {
    const definedColors = await this.prisma.productColor.findMany({
      orderBy: { name: 'asc' },
    });

    const skus = await this.prisma.productSku.findMany({
      where: { color: { not: null } },
      select: { sku: true, name: true, color: true },
    });

    const skuMap = new Map<string, ColorSkuInfoDto[]>();
    for (const s of skus) {
      if (s.color && s.color.trim()) {
        const raw = s.color.trim();
        const c = colorOf(raw) || raw;
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
