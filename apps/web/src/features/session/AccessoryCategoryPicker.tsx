import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Check, RefreshCw } from 'lucide-react';
import type { CatalogProduct, CatalogModel, CatalogSku } from './catalog';
import type { Category, CategoryAttributeSpec } from '../../types/session';
import { formatAccessoryItemName, getSkuAttribute, isOutOfStock } from './catalog';
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
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [lastAddedKey, setLastAddedKey] = useState<string>('');
  const [modelSearch, setModelSearch] = useState<string>('');

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

    // 1. Wallet & Lanyards: Wallet vs Lanyards
    if (groupNameLower.includes('wallet') || groupNameLower.includes('lanyard')) {
      const walletSkus = allSkus.filter((s) => /wallet/i.test(s.name || ''));
      const lanyardSkus = allSkus.filter((s) => /strap|lanyard|crossbody|wrist/i.test(s.name || ''));
      const result: CatalogModel[] = [];
      if (walletSkus.length > 0) {
        result.push({ id: 'model-wallet', name: 'Wallet', skus: walletSkus });
      }
      if (lanyardSkus.length > 0) {
        result.push({ id: 'model-lanyards', name: 'Lanyards', skus: lanyardSkus });
      }
      if (result.length > 0) return result;
    }

    // 2. Mice & Keyboards: Mouse, Magic Keyboard, Trackpad
    if (groupNameLower.includes('mice') || groupNameLower.includes('keyboard')) {
      const mouseSkus = allSkus.filter((s) => /mouse/i.test(s.name || ''));
      const keyboardSkus = allSkus.filter((s) => /keyboard/i.test(s.name || ''));
      const trackpadSkus = allSkus.filter((s) => /trackpad/i.test(s.name || ''));
      const result: CatalogModel[] = [];
      if (mouseSkus.length > 0) {
        result.push({ id: 'model-mouse', name: 'Mouse', skus: mouseSkus });
      }
      if (keyboardSkus.length > 0) {
        result.push({ id: 'model-magic-keyboard', name: 'Magic Keyboard', skus: keyboardSkus });
      }
      if (trackpadSkus.length > 0) {
        result.push({ id: 'model-trackpad', name: 'Trackpad', skus: trackpadSkus });
      }
      if (result.length > 0) return result;
    }

    // 3. Device Protectors for Apple Devices: AirTag Case vs Remote Case
    if (groupNameLower.includes('device protector') || groupNameLower.includes('protector')) {
      const airtagSkus = allSkus.filter((s) => /airtag/i.test(s.name || ''));
      const remoteSkus = allSkus.filter((s) => /remote/i.test(s.name || ''));
      const result: CatalogModel[] = [];
      if (airtagSkus.length > 0) {
        result.push({ id: 'model-airtag-case', name: 'AirTag Case', skus: airtagSkus });
      }
      if (remoteSkus.length > 0) {
        result.push({ id: 'model-remote-case', name: 'Remote Case', skus: remoteSkus });
      }
      if (result.length > 0) return result;
    }

    // 4. Charging Device: Wall Charger vs Wireless Charger
    if (groupNameLower.includes('charge') || groupNameLower.includes('charging')) {
      const wallSkus = allSkus.filter((s) => /\b\d+w\b|wall|power\s*adapter/i.test(s.name || ''));
      const wirelessSkus = allSkus.filter((s) => /magsafe|wireless|qi\b|duo|charger(?!\s*cable)/i.test(s.name || '') && !/\b\d+w\b|power\s*adapter/i.test(s.name || ''));
      const result: CatalogModel[] = [];
      if (wallSkus.length > 0) {
        result.push({ id: 'model-wall-charger', name: 'Wall Charger', skus: wallSkus });
      }
      if (wirelessSkus.length > 0) {
        result.push({ id: 'model-wireless-charger', name: 'Wireless Charger', skus: wirelessSkus });
      }
      if (result.length > 0) return result;
    }

    // 5. Default model list deduplicated by name
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
  }, [products, category.name]);

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

  // Pre-select model from main cart device if applicable and not yet chosen
  useEffect(() => {
    if (selectedModelId || allModels.length <= 1) return;

    const catLower = category.name.toLowerCase();
    if (defaultIPhoneModel && catLower.includes('iphone')) {
      const match = allModels.find((m) =>
        m.name.toLowerCase().includes(defaultIPhoneModel.toLowerCase()) ||
        defaultIPhoneModel.toLowerCase().includes(m.name.toLowerCase()),
      );
      if (match) setSelectedModelId(match.id);
    } else if (defaultIPadModel && catLower.includes('ipad')) {
      const match = allModels.find((m) =>
        m.name.toLowerCase().includes(defaultIPadModel.toLowerCase()) ||
        defaultIPadModel.toLowerCase().includes(m.name.toLowerCase()),
      );
      if (match) setSelectedModelId(match.id);
    }
  }, [allModels, category.name, defaultIPhoneModel, defaultIPadModel, selectedModelId]);

  const activeModel = useMemo(() => {
    if (allModels.length === 1) return allModels[0];
    return allModels.find((m) => m.id === selectedModelId) || null;
  }, [allModels, selectedModelId]);

  // Specification steps customized by business rules (D188)
  const specs = useMemo<CategoryAttributeSpec[]>(() => {
    const groupNameLower = category.name.trim().toLowerCase();
    const activeModelNameLower = activeModel?.name.trim().toLowerCase() || '';

    // 1. NO COLOR groups: Cables & Connectors, Charging Device, Earbud, Headphones and Speakers, Lifestyle & Gadgets
    const isNoColorGroup =
      groupNameLower.includes('cable') ||
      groupNameLower.includes('connector') ||
      groupNameLower.includes('charging') ||
      groupNameLower.includes('charger') ||
      groupNameLower.includes('earbud') ||
      groupNameLower.includes('headphone') ||
      groupNameLower.includes('speaker') ||
      groupNameLower.includes('lifestyle') ||
      groupNameLower.includes('gadget');

    // Models explicitly marked as "ไม่ต้องแก้" (direct item list with add button)
    const isDirectModel =
      activeModelNameLower === 'mouse' ||
      activeModelNameLower === 'trackpad' ||
      activeModelNameLower === 'remote case' ||
      activeModelNameLower === 'wireless charger';

    if (isDirectModel) {
      return [];
    }

    if (
      groupNameLower.includes('cable') ||
      groupNameLower.includes('connector') ||
      groupNameLower.includes('earbud') ||
      groupNameLower.includes('headphone') ||
      groupNameLower.includes('speaker') ||
      groupNameLower.includes('lifestyle')
    ) {
      return [];
    }

    // Charging Device -> Wall Charger: only wattage
    if (groupNameLower.includes('charge') || groupNameLower.includes('charging')) {
      if (activeModelNameLower.includes('wall')) {
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
    if (groupNameLower.includes('wallet') || groupNameLower.includes('lanyard')) {
      if (activeModelNameLower.includes('wallet')) {
        return [
          { key: 'type', label: 'ประเภทกระเป๋า', required: true },
          { key: 'color', label: 'สี', required: true },
        ];
      }
      if (activeModelNameLower.includes('lanyard') || activeModelNameLower.includes('strap')) {
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

    // iPhone Case: ประเภท > สี
    if (groupNameLower.includes('iphone case') || groupNameLower.startsWith('iphone')) {
      return [
        { key: 'caseType', label: 'ประเภทเคส', required: true },
        { key: 'color', label: 'สี', required: true },
      ];
    }

    // iPad Case & Keyboard
    if (groupNameLower.includes('ipad case')) {
      if (activeModelNameLower.includes('keyboard')) {
        return [
          { key: 'type', label: 'ประเภท', required: true },
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
    const skus = activeModel ? activeModel.skus : allModels.flatMap((m) => m.skus);
    const distinctTypes = distinct(skus.map((s) => getSkuAttribute(s, 'type')).filter(Boolean));
    if (distinctTypes.length > 1) {
      fallback.push({ key: 'type', label: 'ประเภท', required: true });
    }
    if (!isNoColorGroup && skus.some((s) => s.color || getSkuAttribute(s, 'color'))) {
      fallback.push({ key: 'color', label: 'สี', required: true });
    }
    return fallback;
  }, [category.attributes, category.name, activeModel, allModels]);

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
      const available = distinct(
        currentCandidates
          .map((s) => getSkuAttribute(s, spec.key))
          .filter(Boolean),
      );

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
    candidatesForStep: CatalogSku[],
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

    // Filter candidates with this selection
    const remainingAfter = candidatesForStep.filter(
      (s) => getSkuAttribute(s, specKey) === optionVal,
    );

    // If this is the last step or resolves to 1 SKU, automatically add to cart!
    const isLastStep = stepIndex === steps.length - 1;
    if (isLastStep && remainingAfter.length > 0) {
      const chosenSku = remainingAfter[0];
      const modelForSku = activeModel || allModels.find((m) => m.skus.some((s) => s.id === chosenSku.id)) || allModels[0];
      const itemKey = formatAccessoryItemName(modelForSku, chosenSku);
      onAddAccessory(itemKey);
      setLastAddedKey(itemKey);
    }
  };

  const handleResetForNext = () => {
    setSelectedValues({});
    setLastAddedKey('');
  };

  const shownModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return allModels;
    return allModels.filter((m) => m.name.toLowerCase().includes(q));
  }, [allModels, modelSearch]);

  const isModelTwoCols = shownModels.length === 2 && shownModels.every((m) => m.name.length <= 18);

  if (allModels.length === 0) {
    return (
      <p className="muted fine" style={{ padding: '8px 0', margin: 0 }}>
        ไม่มีสินค้าในหมวดนี้ในสาขาขณะนี้
      </p>
    );
  }

  return (
    <div className="spec-config-box" style={{ marginTop: '8px' }}>
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
          <div className={`spec-card-grid ${isModelTwoCols ? 'cols-2' : 'cols-1'}`}>
            {shownModels.map((m) => (
              <button
                key={m.id}
                type="button"
                className="spec-option-card"
                onClick={() => {
                  setSelectedModelId(m.id);
                  setSelectedValues({});
                  setModelSearch('');
                }}
              >
                <span className="spec-option-title">{m.name}</span>
                <span className="spec-option-sub">{m.skus.length} แบบ</span>
              </button>
            ))}
          </div>
          {shownModels.length === 0 && (
            <p className="fine muted" style={{ textAlign: 'center', padding: '8px 0' }}>
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
              setLastAddedKey('');
              setModelSearch('');
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
          const isLast = idx === steps.length - 1;
          const isStepTwoCols = st.options.length === 2 && st.options.every((opt) => opt.length <= 16);

          return (
            <div key={st.spec.key} className="spec-config-section">
              <div className="spec-config-section-label">
                <span>
                  {st.spec.label} {isLast && <small style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(กดเพื่อเพิ่มลงรายการ)</small>}
                </span>
                {st.selectedValue && (
                  <span className="spec-config-selected-val"> - {st.selectedValue}</span>
                )}
              </div>

              {isColor ? (
                <div className="spec-swatch-row">
                  {st.options.map((opt) => {
                    const matchingSkus = st.candidatesForStep.filter(
                      (s) => getSkuAttribute(s, st.spec.key) === opt,
                    );
                    const outOfStock = matchingSkus.every((s) => isOutOfStock(s));
                    const hex = colorMap[opt] || colorMap[opt.toLowerCase()] || '#d1d5db';
                    const isSelected = st.selectedValue === opt;

                    return (
                      <button
                        type="button"
                        key={opt}
                        disabled={outOfStock}
                        className={`spec-swatch-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() =>
                          handleSelectOption(idx, st.spec.key, opt, st.candidatesForStep)
                        }
                        title={`${opt}${outOfStock ? ' · สินค้าหมด' : ''}`}
                      >
                        {isSelected && <span className="spec-swatch-ring" />}
                        <span
                          className="spec-swatch-circle"
                          style={{
                            backgroundColor: hex,
                            opacity: outOfStock ? 0.35 : 1,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={`spec-card-grid ${isStepTwoCols ? 'cols-2' : 'cols-1'}`}>
                  {st.options.map((opt) => {
                    const matchingSkus = st.candidatesForStep.filter(
                      (s) => getSkuAttribute(s, st.spec.key) === opt,
                    );
                    const outOfStock = matchingSkus.every((s) => isOutOfStock(s));
                    const isSelected = st.selectedValue === opt;

                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={outOfStock}
                        className={`spec-option-card ${isSelected ? 'selected' : ''}`}
                        onClick={() =>
                          handleSelectOption(idx, st.spec.key, opt, st.candidatesForStep)
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

      {/* Direct SKU list fallback if model has only SKUs without steps */}
      {activeModel && steps.length === 0 && (
        <div className="spec-config-section">
          <div className="spec-config-section-label">
            <span>เลือกสินค้า (กดเพื่อเพิ่มลงรายการ)</span>
          </div>
          <div style={{ display: 'grid', gap: '8px' }}>
            {activeModel.skus.map((sku) => {
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
                    setLastAddedKey(itemKey);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: `1.5px solid ${inCartQty > 0 ? 'var(--primary, #0abab5)' : 'var(--border-color, #e2e8f0)'}`,
                    background: inCartQty > 0 ? 'var(--primary-subtle, #f0fdf4)' : '#ffffff',
                    cursor: outOfStock ? 'not-allowed' : 'pointer',
                    opacity: outOfStock ? 0.45 : 1,
                    textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {sku.name || activeModel.name}
                    </div>
                    <div className="fine muted" style={{ fontSize: '11.5px' }}>{sku.sku}</div>
                  </div>
                  <div>
                    {outOfStock ? (
                      <span style={{ fontSize: '12px', color: '#dc2626' }}>สินค้าหมด</span>
                    ) : inCartQty > 0 ? (
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: '#007d79',
                          background: 'rgba(10, 186, 181, 0.15)',
                          padding: '3px 8px',
                          borderRadius: '12px',
                        }}
                      >
                        ในรายการ ({inCartQty}) +
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--primary, #0abab5)', fontWeight: 600 }}>
                        + เพิ่ม
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation feedback banner when an item was added */}
      {lastAddedKey && (
        <div
          style={{
            padding: '12px 18px',
            background: 'var(--primary-subtle, #e8f7f6)',
            borderTop: '1px solid var(--primary-border, #bbf7d0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: 'var(--primary, #0abab5)',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={14} />
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary-dark, #0d3b39)' }}>
              เพิ่มในรายการเรียบร้อย ({Number(cartAccessories[lastAddedKey]) || 1} ชิ้น)
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetForNext}
            style={{
              border: '1px solid var(--primary, #0abab5)',
              background: '#ffffff',
              color: 'var(--primary, #0abab5)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RefreshCw size={12} /> เลือกชิ้นอื่นต่อ
          </button>
        </div>
      )}
    </div>
  );
}
