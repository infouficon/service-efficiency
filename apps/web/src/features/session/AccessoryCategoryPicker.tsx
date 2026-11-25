import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { CatalogProduct, CatalogModel, CatalogSku } from './catalog';
import type { Category, CategoryAttributeSpec } from '../../types/session';
import {
  formatAccessoryItemName,
  getSkuAttribute,
  isOutOfStock,
  resolveColorHex,
  sortWattageOptions,
  sortCaseSizeOptions,
  sortBandSizeOptions,
} from './catalog';
import { api } from '../../services/api';

const isColorSpec = (spec: CategoryAttributeSpec) =>
  spec.key === 'color' || /สี|colour/i.test(spec.label);

function distinct<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export interface AccessoryCategoryPickerProps {
  category: Category;
  products: CatalogProduct[];
  defaultIPhoneModel?: string;
  defaultIPadModel?: string;
  cartAccessories: Record<string, string>;
  onAddAccessory: (itemKey: string) => void;
}

export function AccessoryCategoryPicker({
  category,
  products,
  defaultIPhoneModel = '',
  defaultIPadModel = '',
  cartAccessories,
  onAddAccessory,
}: AccessoryCategoryPickerProps) {
  const [ipadSubGroup, setIpadSubGroup] = useState<'case' | 'keyboard' | null>(
    null,
  );
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>(
    {},
  );
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [modelSearch, setModelSearch] = useState<string>('');
  const [modelSelectionChanged, setModelSelectionChanged] = useState(false);

  const isIPadCaseGroup = category.name
    .trim()
    .toLowerCase()
    .includes('ipad case');

  // Collect all models across the products in this category, with custom grouping for special categories
  const allModels = useMemo<CatalogModel[]>(() => {
    const list: CatalogModel[] = [];
    const allSkus: CatalogSku[] = [];
    for (const p of products) {
      for (const m of p.models || []) {
        list.push(m);
        for (const s of m.skus || []) {
          allSkus.push(s);
        }
      }
    }

    const groupNameLower = category.name.trim().toLowerCase();

    // 0. Watch Accessories: combine all SKUs into 1 unified model so staff goes straight to 4 steps (D188)
    if (groupNameLower.includes('watch')) {
      return [
        {
          id: 'model-watch-accessories',
          name: 'Watch Accessories',
          skus: allSkus,
        },
      ];
    }

    // 1. Pencil: if only 1 model "Pencil", expand child SKUs into models so staff picks pencil type directly
    if (groupNameLower.includes('pencil')) {
      if (
        list.length === 1 &&
        /^pencil$/i.test(list[0].name.trim()) &&
        allSkus.length > 1
      ) {
        return allSkus.map((s) => ({
          id: s.id,
          name: s.name || 'Apple Pencil',
          skus: [s],
        }));
      }
    }

    // 2. iPad Case: filter models/skus by ipadSubGroup (case vs keyboard)
    if (groupNameLower.includes('ipad case') && ipadSubGroup) {
      const isKeyboard = ipadSubGroup === 'keyboard';
      const filteredModels: CatalogModel[] = [];
      for (const m of list) {
        const matchingSkus = (m.skus || []).filter((s) => {
          const isK =
            /keyboard/i.test(s.name || '') || /keyboard/i.test(s.sku || '');
          return isKeyboard ? isK : !isK;
        });
        if (matchingSkus.length > 0) {
          filteredModels.push({
            ...m,
            skus: matchingSkus,
          });
        }
      }
      return filteredModels;
    }

    // 3. Wallet & Lanyards: Wallet vs Lanyards
    if (
      groupNameLower.includes('wallet') ||
      groupNameLower.includes('lanyard')
    ) {
      const walletSkus = allSkus.filter((s) => /wallet/i.test(s.name || ''));
      const lanyardSkus = allSkus.filter((s) =>
        /strap|lanyard|crossbody|wrist/i.test(s.name || ''),
      );
      const result: CatalogModel[] = [];
      if (walletSkus.length > 0) {
        result.push({ id: 'model-wallet', name: 'Wallet', skus: walletSkus });
      }
      if (lanyardSkus.length > 0) {
        result.push({
          id: 'model-lanyards',
          name: 'Lanyards',
          skus: lanyardSkus,
        });
      }
      if (result.length > 0) return result;
    }

    // 4. Mice & Keyboards: Mouse, Magic Keyboard, Trackpad
    if (
      groupNameLower.includes('mice') ||
      groupNameLower.includes('keyboard')
    ) {
      const mouseSkus = allSkus.filter((s) => /mouse/i.test(s.name || ''));
      const keyboardSkus = allSkus.filter((s) =>
        /keyboard/i.test(s.name || ''),
      );
      const trackpadSkus = allSkus.filter((s) =>
        /trackpad/i.test(s.name || ''),
      );
      const result: CatalogModel[] = [];
      if (mouseSkus.length > 0) {
        result.push({ id: 'model-mouse', name: 'Mouse', skus: mouseSkus });
      }
      if (keyboardSkus.length > 0) {
        result.push({
          id: 'model-magic-keyboard',
          name: 'Magic Keyboard',
          skus: keyboardSkus,
        });
      }
      if (trackpadSkus.length > 0) {
        result.push({
          id: 'model-trackpad',
          name: 'Trackpad',
          skus: trackpadSkus,
        });
      }
      if (result.length > 0) return result;
    }

    // 5. Device Protectors for Apple Devices: AirTag Case vs Remote Case
    if (
      groupNameLower.includes('device protector') ||
      groupNameLower.includes('protector')
    ) {
      const airtagSkus = allSkus.filter((s) => /airtag/i.test(s.name || ''));
      const remoteSkus = allSkus.filter((s) => /remote/i.test(s.name || ''));
      const result: CatalogModel[] = [];
      if (airtagSkus.length > 0) {
        result.push({
          id: 'model-airtag-case',
          name: 'AirTag Case',
          skus: airtagSkus,
        });
      }
      if (remoteSkus.length > 0) {
        result.push({
          id: 'model-remote-case',
          name: 'Remote Case',
          skus: remoteSkus,
        });
      }
      if (result.length > 0) return result;
    }

    // 6. Charging Device: Wall Charger vs Wireless Charger
    if (
      groupNameLower.includes('charge') ||
      groupNameLower.includes('charging')
    ) {
      const wallSkus = allSkus.filter((s) =>
        /\b\d+w\b|wall|power\s*adapter/i.test(s.name || ''),
      );
      const wirelessSkus = allSkus.filter(
        (s) =>
          /magsafe|wireless|qi\b|duo|charger(?!\s*cable)/i.test(s.name || '') &&
          !/\b\d+w\b|power\s*adapter/i.test(s.name || ''),
      );
      const result: CatalogModel[] = [];
      if (wallSkus.length > 0) {
        result.push({
          id: 'model-wall-charger',
          name: 'Wall Charger',
          skus: wallSkus,
        });
      }
      if (wirelessSkus.length > 0) {
        result.push({
          id: 'model-wireless-charger',
          name: 'Wireless Charger',
          skus: wirelessSkus,
        });
      }
      if (result.length > 0) return result;
    }

    // 7. Default model list deduplicated by name
    const map = new Map<string, CatalogModel>();
    for (const m of list) {
      let name = m.name.trim();
      if (/^keyboard$/i.test(name)) name = 'Magic Keyboard';
      const normKey = name.toLowerCase();
      const existing = map.get(normKey);
      if (existing) {
        const existingSkuIds = new Set(existing.skus.map((s) => s.id));
        for (const s of m.skus || []) {
          if (!existingSkuIds.has(s.id)) {
            existing.skus.push(s);
            existingSkuIds.add(s.id);
          }
        }
      } else {
        map.set(normKey, { ...m, name, skus: [...(m.skus || [])] });
      }
    }
    return Array.from(map.values());
  }, [products, category.name, ipadSubGroup]);

  // Load color map for swatch buttons
  useEffect(() => {
    let active = true;
    api<Record<string, string>>('/colors/map')
      .then((m: Record<string, string> | null) => {
        if (active && m) setColorMap(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const activeModel = useMemo(() => {
    if (allModels.length === 1) return allModels[0];
    if (selectedModelId)
      return allModels.find((m) => m.id === selectedModelId) || null;
    if (!modelSelectionChanged) {
      const catLower = category.name.toLowerCase();
      const defaultModel =
        defaultIPhoneModel && catLower.includes('iphone')
          ? defaultIPhoneModel
          : defaultIPadModel && catLower.includes('ipad')
            ? defaultIPadModel
            : '';
      if (defaultModel) {
        return (
          allModels.find(
            (m) =>
              m.name.toLowerCase().includes(defaultModel.toLowerCase()) ||
              defaultModel.toLowerCase().includes(m.name.toLowerCase()),
          ) || null
        );
      }
    }
    return null;
  }, [
    allModels,
    selectedModelId,
    modelSelectionChanged,
    category.name,
    defaultIPhoneModel,
    defaultIPadModel,
  ]);

  // Specification steps customized by business rules (D188)
  const specs = useMemo<CategoryAttributeSpec[]>(() => {
    const groupNameLower = category.name.trim().toLowerCase();
    const activeModelNameLower = activeModel?.name.trim().toLowerCase() || '';

    // 1. NO COLOR groups: Cables & Connectors, Charging Device, Earbud, Headphones and Speakers, Lifestyle & Gadgets, Pencil, Software & Care
    const isNoColorGroup =
      groupNameLower.includes('cable') ||
      groupNameLower.includes('connector') ||
      groupNameLower.includes('charging') ||
      groupNameLower.includes('charger') ||
      groupNameLower.includes('earbud') ||
      groupNameLower.includes('headphone') ||
      groupNameLower.includes('speaker') ||
      groupNameLower.includes('lifestyle') ||
      groupNameLower.includes('gadget') ||
      groupNameLower.includes('pencil') ||
      groupNameLower.includes('software') ||
      groupNameLower.includes('care') ||
      activeModelNameLower === 'mouse' ||
      activeModelNameLower === 'trackpad' ||
      activeModelNameLower === 'remote case' ||
      activeModelNameLower.includes('pencil tip');

    // Direct items with NO steps (select items inside directly)
    if (
      groupNameLower.includes('cable') ||
      groupNameLower.includes('connector') ||
      groupNameLower.includes('earbud') ||
      groupNameLower.includes('headphone') ||
      groupNameLower.includes('speaker') ||
      groupNameLower.includes('lifestyle') ||
      groupNameLower.includes('gadget') ||
      groupNameLower.includes('pencil') ||
      groupNameLower.includes('software') ||
      groupNameLower.includes('care') ||
      activeModelNameLower === 'mouse' ||
      activeModelNameLower === 'trackpad' ||
      activeModelNameLower === 'remote case' ||
      activeModelNameLower.includes('pencil tip')
    ) {
      return [];
    }

    // Charging Device: both Wall Charger and Wireless Charger split by wattage first (D188) - NO COLOR!
    if (
      groupNameLower.includes('charge') ||
      groupNameLower.includes('charging')
    ) {
      const skus = activeModel
        ? activeModel.skus
        : allModels.flatMap((m) => m.skus);
      const hasWattage = skus.some((s) =>
        Boolean(getSkuAttribute(s, 'wattage')),
      );
      if (hasWattage) {
        return [{ key: 'wattage', label: 'จำนวนวัตต์', required: true }];
      }
      return [];
    }

    // Watch Accessories: ขนาดตัวเรือน > สาย > ขนาดสาย Band Size > สี
    if (groupNameLower.includes('watch')) {
      return [
        { key: 'caseSize', label: 'ขนาดตัวเรือน', required: true },
        { key: 'band', label: 'สายนาฬิกา', required: true },
        { key: 'bandSize', label: 'ขนาดสาย (Band Size)', required: true },
        { key: 'color', label: 'สี', required: true },
      ];
    }

    // Wallet & Lanyards
    if (
      groupNameLower.includes('wallet') ||
      groupNameLower.includes('lanyard')
    ) {
      if (activeModelNameLower.includes('wallet')) {
        return [{ key: 'color', label: 'สี', required: true }];
      }
      if (
        activeModelNameLower.includes('lanyard') ||
        activeModelNameLower.includes('strap')
      ) {
        return [
          { key: 'type', label: 'ประเภทสาย', required: true },
          { key: 'color', label: 'สี', required: true },
        ];
      }
    }

    // Mice & Keyboards -> Magic Keyboard: Touch ID > Numeric Keypad > ภาษา > สี
    if (activeModelNameLower.includes('keyboard')) {
      return [
        { key: 'touchId', label: 'Touch ID', required: true },
        { key: 'numericKeypad', label: 'Numeric Keypad', required: true },
        { key: 'language', label: 'ภาษาแป้นพิมพ์', required: true },
        { key: 'color', label: 'สี', required: true },
      ];
    }

    // Device Protectors -> AirTag Case: ประเภท > สี
    if (activeModelNameLower.includes('airtag')) {
      return [
        { key: 'type', label: 'ประเภท', required: true },
        { key: 'color', label: 'สี', required: true },
      ];
    }

    // iPhone Case: ประเภทเคส > สี
    if (
      groupNameLower.includes('iphone case') ||
      groupNameLower.startsWith('iphone')
    ) {
      return [
        { key: 'caseType', label: 'ประเภทเคส', required: true },
        { key: 'color', label: 'สี', required: true },
      ];
    }

    // iPad Case & Keyboard
    if (
      groupNameLower.includes('ipad case') ||
      groupNameLower.startsWith('ipad')
    ) {
      if (
        ipadSubGroup === 'keyboard' ||
        activeModelNameLower.includes('keyboard')
      ) {
        return [
          { key: 'language', label: 'ภาษาแป้นพิมพ์', required: true },
          { key: 'color', label: 'สี', required: true },
        ];
      }
      return [
        { key: 'caseType', label: 'ประเภทเคส', required: true },
        { key: 'color', label: 'สี', required: true },
      ];
    }

    // Fallback: If Admin configured custom category.attributes, respect it:
    if (category.attributes && category.attributes.length > 0) {
      if (isNoColorGroup) {
        return category.attributes.filter((a) => a.key !== 'color');
      }
      return category.attributes;
    }

    // Fallback for any other category
    const fallback: CategoryAttributeSpec[] = [];
    const skus = activeModel
      ? activeModel.skus
      : allModels.flatMap((m) => m.skus);
    const distinctTypes = distinct(
      skus.map((s) => getSkuAttribute(s, 'type')).filter(Boolean),
    );
    if (distinctTypes.length > 1) {
      fallback.push({ key: 'type', label: 'ประเภท', required: true });
    }
    if (
      !isNoColorGroup &&
      skus.some((s) => s.color || getSkuAttribute(s, 'color'))
    ) {
      fallback.push({ key: 'color', label: 'สี', required: true });
    }
    return fallback;
  }, [
    category.attributes,
    category.name,
    activeModel,
    allModels,
    ipadSubGroup,
  ]);

  // Compute steps and remaining SKUs based on current selections
  const { steps, candidates } = useMemo(() => {
    const modelSkus = activeModel
      ? activeModel.skus
      : allModels.flatMap((m) => m.skus);

    let currentCandidates = modelSkus;
    const computedSteps: {
      spec: CategoryAttributeSpec;
      options: string[];
      selectedValue: string;
      candidatesForStep: CatalogSku[];
    }[] = [];

    for (const spec of specs) {
      let available = distinct(
        currentCandidates
          .map((s) => getSkuAttribute(s, spec.key))
          .filter(Boolean),
      );

      const isWattage =
        spec.key.toLowerCase().includes('watt') ||
        spec.label.includes('วัตต์') ||
        (available.length > 0 &&
          available.every((opt) => /^\d+\s*w$/i.test(opt.trim())));
      const isCaseSize =
        spec.key.toLowerCase().includes('casesize') ||
        spec.label.includes('ขนาดตัวเรือน') ||
        (available.length > 0 &&
          available.every((opt) => /^\d+\s*mm$/i.test(opt.trim())));
      const isBandSize =
        spec.key.toLowerCase().includes('bandsize') ||
        spec.label.includes('ขนาดสาย') ||
        (available.length > 0 &&
          available.every((opt) => /^(?:s\/m|m\/l|size\s*\d+|xs|s|m|l|xl|one\s*size)$/i.test(opt.trim())));

      if (isWattage) {
        available = sortWattageOptions(available);
      } else if (isCaseSize) {
        available = sortCaseSizeOptions(available);
      } else if (isBandSize) {
        available = sortBandSizeOptions(available);
      }

      if (available.length > 0) {
        const val = selectedValues[spec.key] ?? '';
        computedSteps.push({
          spec,
          options: available,
          selectedValue: val,
          candidatesForStep: currentCandidates,
        });
        if (val) {
          currentCandidates = currentCandidates.filter(
            (s) => getSkuAttribute(s, spec.key) === val,
          );
        }
      }
    }

    return { steps: computedSteps, candidates: currentCandidates };
  }, [activeModel, allModels, specs, selectedValues]);

  // When staff clicks an option
  const handleSelectOption = (
    stepIndex: number,
    specKey: string,
    optionVal: string,
  ) => {
    const nextValues: Record<string, string> = {};
    for (let i = 0; i < stepIndex; i++) {
      const prevKey = steps[i].spec.key;
      if (selectedValues[prevKey]) {
        nextValues[prevKey] = selectedValues[prevKey];
      }
    }
    nextValues[specKey] = optionVal;
    setSelectedValues(nextValues);
  };

  const shownModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return allModels;
    return allModels.filter((m) => m.name.toLowerCase().includes(q));
  }, [allModels, modelSearch]);

  const isModelTwoCols =
    shownModels.length === 2 && shownModels.every((m) => m.name.length <= 18);

  // If iPad Case group and user hasn't selected sub-group (iPad Case vs iPad Keyboard Case), show choice first
  if (isIPadCaseGroup && !ipadSubGroup) {
    return (
      <div className="spec-config-box" style={{ marginTop: '8px' }}>
        <div className="spec-config-section">
          <div className="spec-config-section-label">
            <span>เลือกประเภท ({category.name})</span>
          </div>
          <div className="spec-card-grid cols-2">
            <button
              type="button"
              className="spec-option-card"
              onClick={() => {
                setIpadSubGroup('case');
                setSelectedModelId('');
                setSelectedValues({});
                setModelSelectionChanged(true);
              }}
            >
              <span className="spec-option-title">iPad Case</span>
              <span className="spec-option-sub">เคสสำหรับ iPad</span>
            </button>
            <button
              type="button"
              className="spec-option-card"
              onClick={() => {
                setIpadSubGroup('keyboard');
                setSelectedModelId('');
                setSelectedValues({});
                setModelSelectionChanged(true);
              }}
            >
              <span className="spec-option-title">iPad Keyboard Case</span>
              <span className="spec-option-sub">
                เคสคีย์บอร์ด Magic Keyboard
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (allModels.length === 0) {
    return (
      <p className="muted fine" style={{ padding: '8px 0', margin: 0 }}>
        ไม่มีสินค้าในหมวดนี้ในสาขาขณะนี้
      </p>
    );
  }

  const allStepsCompleted =
    steps.length > 0 && steps.every((st) => Boolean(st.selectedValue));

  const singleResolvedSku =
    activeModel &&
    steps.length > 0 &&
    allStepsCompleted &&
    candidates.length === 1
      ? candidates[0]
      : null;
  const singleItemKey =
    singleResolvedSku && activeModel
      ? formatAccessoryItemName(activeModel, singleResolvedSku)
      : '';
  const singleInCartQty = singleItemKey
    ? Number(cartAccessories[singleItemKey]) || 0
    : 0;
  const singleOutOfStock = singleResolvedSku
    ? isOutOfStock(singleResolvedSku)
    : false;

  return (
    <div className="spec-config-box" style={{ marginTop: '8px' }}>
      {/* For iPad Case: Sub-group indicator and change button */}
      {isIPadCaseGroup && ipadSubGroup && (
        <div
          className="spec-config-header"
          style={{
            padding: '16px 20px',
            background: 'var(--bg-subtle, #f8fafc)',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: 'var(--primary-dark, #0d3b39)',
                background: 'rgba(10, 186, 181, 0.12)',
                padding: '4px 12px',
                borderRadius: '6px',
              }}
            >
              {ipadSubGroup === 'keyboard' ? 'iPad Keyboard Case' : 'iPad Case'}
            </span>
          </div>
          <button
            type="button"
            className="picked-model-change"
            onClick={() => {
              setIpadSubGroup(null);
              setSelectedModelId('');
              setSelectedValues({});
              setModelSelectionChanged(true);
            }}
          >
            เปลี่ยนประเภท
          </button>
        </div>
      )}

      {/* Step 1: Model Selection (if multiple models exist and none active yet) */}
      {allModels.length > 1 && !activeModel && (
        <div className="spec-config-section">
          <div className="spec-config-section-label">
            <span>เลือกรุ่นสินค้า ({category.name})</span>
          </div>
          {allModels.length > 6 && (
            <div style={{ marginBottom: '10px' }}>
              <input
                type="search"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="ค้นหารุ่นสินค้า เช่น Air 11..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          <div
            className={`spec-card-grid ${isModelTwoCols ? 'cols-2' : 'cols-1'}`}
          >
            {shownModels.map((m) => (
              <button
                key={m.id}
                type="button"
                className="spec-option-card"
                onClick={() => {
                  setSelectedModelId(m.id);
                  setSelectedValues({});
                  setModelSearch('');
                  setModelSelectionChanged(true);
                }}
              >
                <span className="spec-option-title">{m.name}</span>
                <span className="spec-option-sub">{m.skus.length} แบบ</span>
              </button>
            ))}
          </div>
          {shownModels.length === 0 && (
            <p
              className="fine muted"
              style={{ textAlign: 'center', padding: '8px 0' }}
            >
              ไม่พบรุ่นสินค้าที่ตรงกับคำค้นหา
            </p>
          )}
        </div>
      )}

      {/* Header if model is chosen and there are other models to change to */}
      {activeModel && allModels.length > 1 && (
        <div className="spec-config-header">
          <div>
            <h4 className="spec-config-title">{activeModel.name}</h4>
          </div>
          <button
            type="button"
            className="picked-model-change"
            onClick={() => {
              setSelectedModelId('');
              setSelectedValues({});
              setModelSearch('');
              setModelSelectionChanged(true);
            }}
          >
            เปลี่ยนรุ่น
          </button>
        </div>
      )}

      {/* Step-by-Step Attribute Configuration (from category.attributes) */}
      {activeModel &&
        steps.map((st, idx) => {
          const prevStepsDone = steps
            .slice(0, idx)
            .every((prev) => Boolean(prev.selectedValue));
          if (!prevStepsDone) return null;

          const isColor = isColorSpec(st.spec);
          const isWattage =
            st.spec.key.toLowerCase().includes('watt') ||
            st.spec.label.includes('วัตต์') ||
            (st.options.length > 0 &&
              st.options.every((opt) => /^\d+\s*w$/i.test(opt.trim())));
          const isCaseSize =
            st.spec.key.toLowerCase().includes('casesize') ||
            st.spec.label.includes('ขนาดตัวเรือน') ||
            (st.options.length > 0 &&
              st.options.every((opt) => /^\d+\s*mm$/i.test(opt.trim())));
          const isBandSize =
            st.spec.key.toLowerCase().includes('bandsize') ||
            st.spec.label.includes('ขนาดสาย') ||
            (st.options.length > 0 &&
              st.options.every((opt) => /^(?:s\/m|m\/l|size\s*\d+|xs|s|m|l|xl|one\s*size)$/i.test(opt.trim())));
          const isCompact = isWattage || isCaseSize || isBandSize;
          const isStepTwoCols =
            st.options.length === 2 &&
            st.options.every((opt) => opt.length <= 16);

          return (
            <div key={st.spec.key} className="spec-config-section">
              <div className="spec-config-section-label">
                <span>{st.spec.label}</span>
                {st.selectedValue && (
                  <span className="spec-config-selected-val">
                    {' '}
                    - {st.selectedValue}
                  </span>
                )}
              </div>

              {isColor ? (
                <div className="spec-swatch-row">
                  {st.options.map((opt) => {
                    const matchingSkus = st.candidatesForStep.filter(
                      (s) => getSkuAttribute(s, st.spec.key) === opt,
                    );
                    const outOfStock = matchingSkus.every((s) =>
                      isOutOfStock(s),
                    );
                    const hex = resolveColorHex(opt, colorMap);
                    const isSelected = st.selectedValue === opt;
                    const isImg =
                      typeof hex === 'string' &&
                      (/^https?:\/\/.+/i.test(hex) ||
                        /^data:image\/.+/i.test(hex));

                    return (
                      <button
                        type="button"
                        key={opt}
                        disabled={outOfStock}
                        className={`spec-swatch-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() =>
                          handleSelectOption(idx, st.spec.key, opt)
                        }
                        title={`${opt}${outOfStock ? ' · สินค้าหมด' : ''}`}
                      >
                        {isSelected && <span className="spec-swatch-ring" />}
                        <span
                          className="spec-swatch-circle"
                          style={{
                            backgroundColor: isImg ? 'transparent' : hex,
                            backgroundImage: isImg
                              ? `url("${hex}")`
                              : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            backgroundRepeat: 'no-repeat',
                            opacity: outOfStock ? 0.35 : 1,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              ) : isCompact ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
                    gap: '8px',
                  }}
                >
                  {st.options.map((opt) => {
                    const matchingSkus = st.candidatesForStep.filter(
                      (s) => getSkuAttribute(s, st.spec.key) === opt,
                    );
                    const outOfStock = matchingSkus.every((s) =>
                      isOutOfStock(s),
                    );
                    const isSelected = st.selectedValue === opt;

                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={outOfStock}
                        className={`spec-option-card ${isSelected ? 'selected' : ''}`}
                        onClick={() =>
                          handleSelectOption(idx, st.spec.key, opt)
                        }
                        style={{
                          padding: '10px 8px',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minHeight: '46px',
                        }}
                      >
                        <span
                          className="spec-option-title"
                          style={{ fontSize: '13.5px', fontWeight: 600 }}
                        >
                          {opt}
                        </span>
                        {outOfStock && (
                          <span
                            className="spec-option-sub out-of-stock"
                            style={{ fontSize: '10px' }}
                          >
                            สินค้าหมด
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`spec-card-grid ${isStepTwoCols ? 'cols-2' : 'cols-1'}`}
                >
                  {st.options.map((opt) => {
                    const matchingSkus = st.candidatesForStep.filter(
                      (s) => getSkuAttribute(s, st.spec.key) === opt,
                    );
                    const outOfStock = matchingSkus.every((s) =>
                      isOutOfStock(s),
                    );
                    const isSelected = st.selectedValue === opt;

                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={outOfStock}
                        className={`spec-option-card ${isSelected ? 'selected' : ''}`}
                        onClick={() =>
                          handleSelectOption(idx, st.spec.key, opt)
                        }
                      >
                        <span className="spec-option-title">{opt}</span>
                        {outOfStock && (
                          <span className="spec-option-sub out-of-stock">
                            สินค้าหมด
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

      {/* If steps are configured and completed, show single prominent "เพิ่มสินค้า" button at bottom without redundant SKU card */}
      {singleResolvedSku && (
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color, #f1f5f9)',
            background: '#ffffff',
          }}
        >
          <button
            type="button"
            disabled={singleOutOfStock}
            onClick={() => {
              onAddAccessory(singleItemKey);
            }}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: '10px',
              background: singleOutOfStock
                ? '#9ca3af'
                : singleInCartQty > 0
                  ? '#007d79'
                  : 'var(--primary, #0abab5)',
              color: '#ffffff',
              border: 'none',
              fontSize: '15px',
              fontWeight: 600,
              cursor: singleOutOfStock ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: singleOutOfStock
                ? 'none'
                : '0 2px 8px rgba(10, 186, 181, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            <Plus size={18} />
            {singleOutOfStock
              ? 'สินค้าหมด'
              : singleInCartQty > 0
                ? `เพิ่มแล้ว (${singleInCartQty} ชิ้น) +`
                : 'เพิ่มสินค้า'}
          </button>
        </div>
      )}

      {/* Direct SKU list fallback when:
          1. Model has no steps (e.g. Cables, Earbud, Lifestyle, Pencil, etc.)
          2. OR steps are completed and multiple candidate SKUs match
      */}
      {activeModel &&
        (steps.length === 0 ||
          (allStepsCompleted && candidates.length > 1)) && (
          <div className="spec-config-section">
            <div className="spec-config-section-label">
              <span>
                เลือกสินค้า (
                {candidates.length > 0
                  ? `${candidates.length} รายการ`
                  : 'กดเพื่อเพิ่ม'}
                )
              </span>
            </div>
            <div style={{ display: 'grid', gap: '8px' }}>
              {(steps.length === 0 ? activeModel.skus : candidates).map(
                (sku) => {
                  const itemKey = formatAccessoryItemName(activeModel, sku);
                  const inCartQty = Number(cartAccessories[itemKey]) || 0;
                  const outOfStock = isOutOfStock(sku);

                  return (
                    <button
                      key={sku.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => {
                        onAddAccessory(itemKey);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        border: `1.5px solid ${inCartQty > 0 ? 'var(--primary, #0abab5)' : 'var(--border-color, #e2e8f0)'}`,
                        background:
                          inCartQty > 0
                            ? 'var(--primary-subtle, #f0fdf4)'
                            : '#ffffff',
                        cursor: outOfStock ? 'not-allowed' : 'pointer',
                        opacity: outOfStock ? 0.45 : 1,
                        textAlign: 'left',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '13.5px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {sku.name || activeModel.name}
                        </div>
                        <div
                          className="fine muted"
                          style={{ fontSize: '11.5px' }}
                        >
                          {sku.sku}
                        </div>
                      </div>
                      <div>
                        {outOfStock ? (
                          <span style={{ fontSize: '12px', color: '#dc2626' }}>
                            สินค้าหมด
                          </span>
                        ) : inCartQty > 0 ? (
                          <span
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: '#007d79',
                              background: 'rgba(10, 186, 181, 0.15)',
                              padding: '3px 10px',
                              borderRadius: '12px',
                            }}
                          >
                            ในรายการ ({inCartQty})
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '12.5px',
                              color: 'var(--primary, #0abab5)',
                              fontWeight: 600,
                            }}
                          >
                            +
                          </span>
                        )}
                      </div>
                    </button>
                  );
                },
              )}
            </div>
          </div>
        )}
    </div>
  );
}
