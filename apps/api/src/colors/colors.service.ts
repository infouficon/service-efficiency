import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { colorOf } from '../warroom/warroom-sync.service';

export interface ColorItemDto {
  id: string | null;
  name: string;
  hexCode: string;
  skuCount: number;
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
      select: { color: true },
    });

    const skuCounts = new Map<string, number>();
    for (const s of skus) {
      if (s.color && s.color.trim()) {
        const raw = s.color.trim();
        const c = colorOf(raw) || raw;
        skuCounts.set(c, (skuCounts.get(c) ?? 0) + 1);
      }
    }

    const definedMap = new Map<string, { id: string; hexCode: string }>();
    for (const dc of definedColors) {
      const cleanName = colorOf(dc.name) || dc.name;
      if (!definedMap.has(cleanName) || dc.hexCode) {
        definedMap.set(cleanName, { id: dc.id, hexCode: dc.hexCode });
      }
    }

    const allNames = new Set<string>([...definedMap.keys(), ...skuCounts.keys()]);
    const result: ColorItemDto[] = Array.from(allNames).map((name) => {
      const def = definedMap.get(name);
      return {
        id: def?.id ?? null,
        name,
        hexCode: def?.hexCode ?? '',
        skuCount: skuCounts.get(name) ?? 0,
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
