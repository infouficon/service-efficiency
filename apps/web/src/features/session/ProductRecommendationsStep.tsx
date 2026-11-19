import { useState, useMemo } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '../../components/ui';
import type { MockSession } from '../../types/session';
import {
  getMainProductRecommendations,
  getAdditionalEcosystemItems,
  type RecommendationVariant,
  type AdditionalItemStatus,
} from './recommendations';

interface ProductRecommendationsStepProps {
  session: MockSession;
  busy: boolean;
  onProceed: (
    interestedAccessories: Record<string, string>,
    records: Array<{
      id: string;
      name: string;
      skuCode: string;
      section: 'MAIN' | 'ADDITIONAL';
      status: 'RECOMMENDED' | 'INTERESTED' | 'OWNED' | 'OLD_MODEL' | 'NONE';
    }>,
  ) => void;
}

export function ProductRecommendationsStep({
  session,
  busy,
  onProceed,
}: ProductRecommendationsStepProps) {
  // Extract all main products from session selection
  const mainProducts = useMemo(() => {
    const items = session.selection?.items || [];
    if (items.length > 0) {
      return items.map((it, idx) => ({
        index: idx,
        id: it.id || `item-${idx}`,
        name:
          it.product.model ||
          it.product.product ||
          it.product.sku ||
          `สินค้าชิ้นที่ ${idx + 1}`,
      }));
    }
    // Fallback if no item was selected in Step 1
    return [{ index: 0, id: 'item-default', name: 'สินค้าทั่วไป' }];
  }, [session.selection?.items]);

  // Generate 3 recommendations for EACH main product
  const mainProductGroups = useMemo(() => {
    return mainProducts.map((p) => ({
      product: p,
      recommendations: getMainProductRecommendations(p.name, `p-${p.index}`),
    }));
  }, [mainProducts]);

  // Additional ecosystem items
  const additionalItems = useMemo(() => getAdditionalEcosystemItems(), []);

  // State: tracking collapsed main product groups
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  const toggleCollapseGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // State: selected variant for Section 1 recommendations
  const [selectedVariants, setSelectedVariants] = useState<
    Record<string, RecommendationVariant>
  >(() => {
    const map: Record<string, RecommendationVariant> = {};
    for (const group of mainProductGroups) {
      for (const item of group.recommendations) {
        const savedRec = session.recommendationRecords?.find(
          (r) => r.id === item.id,
        );
        const matchedVariant = savedRec
          ? item.variants.find((v) => v.skuCode === savedRec.skuCode)
          : null;
        if (matchedVariant) {
          map[item.id] = matchedVariant;
        } else if (item.variants.length > 0) {
          map[item.id] = item.variants[0];
        }
      }
    }
    for (const item of additionalItems) {
      const savedRec = session.recommendationRecords?.find(
        (r) => r.id === item.id,
      );
      const matchedVariant = savedRec
        ? item.variants.find((v) => v.skuCode === savedRec.skuCode)
        : null;
      if (matchedVariant) {
        map[item.id] = matchedVariant;
      } else if (item.variants.length > 0) {
        map[item.id] = item.variants[0];
      }
    }
    return map;
  });

  // State: tracking which cards have expanded "ดูตัวเลือกอื่น"
  const [expandedVariants, setExpandedVariants] = useState<
    Record<string, boolean>
  >({});

  // State: tracking recommendation & interest status for Section 1
  const [mainItemStatus, setMainItemStatus] = useState<
    Record<string, { recommended: boolean; interested: boolean }>
  >(() => {
    const initial: Record<
      string,
      { recommended: boolean; interested: boolean }
    > = {};
    if (session.recommendationRecords) {
      for (const rec of session.recommendationRecords) {
        if (rec.section === 'MAIN') {
          initial[rec.id] = {
            recommended:
              rec.status === 'RECOMMENDED' || rec.status === 'INTERESTED',
            interested: rec.status === 'INTERESTED',
          };
        }
      }
    }
    return initial;
  });

  // State: tracking status for Section 2 items ({ recommended: boolean; status: AdditionalItemStatus })
  const [additionalItemState, setAdditionalItemState] = useState<
    Record<string, { recommended: boolean; status: AdditionalItemStatus }>
  >(() => {
    const initial: Record<
      string,
      { recommended: boolean; status: AdditionalItemStatus }
    > = {};
    if (session.recommendationRecords) {
      for (const rec of session.recommendationRecords) {
        if (rec.section === 'ADDITIONAL') {
          const isRec =
            rec.status === 'RECOMMENDED' ||
            rec.status === 'OWNED' ||
            rec.status === 'OLD_MODEL' ||
            rec.status === 'INTERESTED';
          initial[rec.id] = {
            recommended: isRec,
            status: rec.status,
          };
        }
      }
    }
    return initial;
  });

  // Toggle "ดูตัวเลือกอื่น" dropdown
  const toggleVariantDropdown = (itemId: string) => {
    setExpandedVariants((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  // Select a variant
  const handleSelectVariant = (
    itemId: string,
    variant: RecommendationVariant,
  ) => {
    setSelectedVariants((prev) => ({
      ...prev,
      [itemId]: variant,
    }));
    setExpandedVariants((prev) => ({
      ...prev,
      [itemId]: false,
    }));
  };

  // Toggle "แนะนำ" for main item
  const handleToggleMainRecommend = (itemId: string) => {
    setMainItemStatus((prev) => {
      const current = prev[itemId] || { recommended: false, interested: false };
      const nextRecommended = !current.recommended;
      // If un-recommending, also un-mark interested
      const nextInterested = nextRecommended ? current.interested : false;
      return {
        ...prev,
        [itemId]: {
          recommended: nextRecommended,
          interested: nextInterested,
        },
      };
    });
  };

  // Toggle "สนใจ" for main item (marking interested automatically marks recommended)
  const handleToggleMainInterest = (itemId: string) => {
    setMainItemStatus((prev) => {
      const current = prev[itemId] || { recommended: false, interested: false };
      const nextInterested = !current.interested;
      return {
        ...prev,
        [itemId]: {
          recommended: nextInterested ? true : current.recommended,
          interested: nextInterested,
        },
      };
    });
  };

  // Set status for additional item (OWNED, OLD_MODEL, INTERESTED)
  const handleSetAdditionalStatus = (
    itemId: string,
    status: 'OWNED' | 'OLD_MODEL' | 'INTERESTED',
  ) => {
    setAdditionalItemState((prev) => {
      const current = prev[itemId] || { recommended: false, status: 'NONE' };
      const nextStatus = current.status === status ? 'NONE' : status;
      // When OWNED, OLD_MODEL, or INTERESTED is clicked, recommended automatically becomes true!
      const nextRecommended =
        nextStatus !== 'NONE' ? true : current.recommended;
      return {
        ...prev,
        [itemId]: {
          recommended: nextRecommended,
          status: nextStatus,
        },
      };
    });
  };

  // Toggle "แนะนำ" for additional item
  const handleToggleAdditionalRecommend = (itemId: string) => {
    setAdditionalItemState((prev) => {
      const current = prev[itemId] || { recommended: false, status: 'NONE' };
      const nextRecommended = !current.recommended;
      // If un-recommending, clear customer status as well
      const nextStatus = nextRecommended ? current.status : 'NONE';
      return {
        ...prev,
        [itemId]: {
          recommended: nextRecommended,
          status: nextStatus,
        },
      };
    });
  };

  // Handle proceed to next step
  const handleConfirmStep = () => {
    const interestedAcc: Record<string, string> = {};
    const records: Array<{
      id: string;
      name: string;
      skuCode: string;
      section: 'MAIN' | 'ADDITIONAL';
      status: 'RECOMMENDED' | 'INTERESTED' | 'OWNED' | 'OLD_MODEL' | 'NONE';
    }> = [];

    // Process Section 1 items across all main product groups
    for (const group of mainProductGroups) {
      for (const item of group.recommendations) {
        const current = mainItemStatus[item.id] || {
          recommended: false,
          interested: false,
        };
        const activeVariant = selectedVariants[item.id];
        const activeSku = activeVariant?.skuCode || item.skuCode;
        const activeName = activeVariant?.name || item.name;

        let status: 'RECOMMENDED' | 'INTERESTED' | 'NONE' = 'NONE';
        if (current.interested) {
          status = 'INTERESTED';
          if (item.accessoryCategory) {
            interestedAcc[item.accessoryCategory] = '1';
          }
        } else if (current.recommended) {
          status = 'RECOMMENDED';
        }

        records.push({
          id: item.id,
          name: activeName,
          skuCode: activeSku,
          section: 'MAIN',
          status,
        });
      }
    }

    // Process Section 2 items
    for (const item of additionalItems) {
      const current = additionalItemState[item.id] || {
        recommended: false,
        status: 'NONE',
      };
      const activeVariant = selectedVariants[item.id];
      const activeSku = activeVariant?.skuCode || item.skuCode;
      const activeName = activeVariant?.name || item.name;

      const isRec =
        current.recommended ||
        current.status === 'OWNED' ||
        current.status === 'OLD_MODEL' ||
        current.status === 'INTERESTED';

      const finalStatus: AdditionalItemStatus =
        current.status !== 'NONE'
          ? current.status
          : isRec
            ? 'RECOMMENDED'
            : 'NONE';

      if (finalStatus === 'INTERESTED' && item.accessoryCategory) {
        interestedAcc[item.accessoryCategory] = '1';
      }
      records.push({
        id: item.id,
        name: activeName,
        skuCode: activeSku,
        section: 'ADDITIONAL',
        status: finalStatus,
      });
    }

    onProceed(interestedAcc, records);
  };

  // Count totals for display
  const recommendedCount = useMemo(() => {
    let count = 0;
    for (const val of Object.values(mainItemStatus)) {
      if (val.recommended) count++;
    }
    for (const val of Object.values(additionalItemState)) {
      if (
        val.recommended ||
        val.status === 'RECOMMENDED' ||
        val.status === 'OWNED' ||
        val.status === 'OLD_MODEL' ||
        val.status === 'INTERESTED'
      ) {
        count++;
      }
    }
    return count;
  }, [mainItemStatus, additionalItemState]);

  const interestedCount = useMemo(() => {
    let count = 0;
    for (const val of Object.values(mainItemStatus)) {
      if (val.interested) count++;
    }
    for (const val of Object.values(additionalItemState)) {
      if (val.status === 'INTERESTED') count++;
    }
    return count;
  }, [mainItemStatus, additionalItemState]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        paddingBottom: '2.5rem',
      }}
    >
      {/* SECTION 1: สินค้าแนะนำสำหรับสินค้าหลักแต่ละตัว */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '18px 20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <Sparkles size={18} color="#0abab5" />
            <h3
              style={{
                margin: 0,
                fontSize: '15.5px',
                fontWeight: 700,
                color: '#0f172a',
              }}
            >
              1. สินค้าแนะนำสำหรับสินค้าหลัก
            </h3>
          </div>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '12.5px',
              color: '#64748b',
            }}
          >
            แนะนำอุปกรณ์เสริมที่เข้าคู่กันสำหรับสินค้าหลักแต่ละชิ้นที่ลูกค้าเลือก
          </p>
        </div>

        {/* Groups per Main Product */}
        {mainProductGroups.map((group, gIdx) => {
          const isCollapsed = Boolean(collapsedGroups[group.product.id]);

          return (
            <div
              key={group.product.id}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '18px 20px',
                transition: 'all 0.2s ease',
              }}
            >
              {/* Header of this Main Product (Clickable to collapse/expand) */}
              <div
                onClick={() => toggleCollapseGroup(group.product.id)}
                role="button"
                tabIndex={0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: isCollapsed ? 0 : '14px',
                  paddingBottom: isCollapsed ? 0 : '10px',
                  borderBottom: isCollapsed ? 'none' : '1.5px solid #f1f5f9',
                  flexWrap: 'wrap',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      background: '#0abab5',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                    }}
                  >
                    สินค้าหลัก #{gIdx + 1}
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#0f172a',
                    }}
                  >
                    {group.product.name}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    color: '#64748b',
                  }}
                >
                  {isCollapsed ? (
                    <ChevronDown size={18} color="#64748b" />
                  ) : (
                    <ChevronUp size={18} color="#64748b" />
                  )}
                </div>
              </div>

              {/* 3 Recommendation Cards for this main product */}
              {!isCollapsed && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  {group.recommendations.map((item, idx) => {
                    const activeVariant = selectedVariants[item.id];
                    const isExpanded = Boolean(expandedVariants[item.id]);
                    const status = mainItemStatus[item.id] || {
                      recommended: false,
                      interested: false,
                    };
                    const displayName = activeVariant?.name || item.name;
                    const displayPrice = activeVariant?.price ?? item.price;
                    const displaySku = activeVariant?.skuCode || item.skuCode;

                    return (
                      <div
                        key={item.id}
                        style={{
                          background: status.interested
                            ? '#f0fdfa'
                            : status.recommended
                              ? '#f8fafc'
                              : '#ffffff',
                          border: status.interested
                            ? '2px solid #0abab5'
                            : status.recommended
                              ? '1.5px solid #99f6e4'
                              : '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '16px 18px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {/* Top: Circle badge + Category & Brand & SKU */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '10px',
                          }}
                        >
                          <div
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '50%',
                              background: '#eff6ff',
                              color: '#2563eb',
                              fontWeight: 700,
                              fontSize: '14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {idx + 1}
                          </div>
                          <div
                            style={{
                              fontSize: '12.5px',
                              color: '#64748b',
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span>{item.category}</span>
                            <span>•</span>
                            <span style={{ fontWeight: 600, color: '#334155' }}>
                              {item.brand}
                            </span>
                            <span
                              style={{
                                background: '#f1f5f9',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                color: '#64748b',
                              }}
                            >
                              {displaySku}
                            </span>
                          </div>
                        </div>

                        {/* Middle: Product Title + Price */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '12px',
                            marginBottom: '14px',
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: '14.5px',
                              color: '#0f172a',
                              lineHeight: '1.4',
                              flex: 1,
                            }}
                          >
                            {displayName}
                          </div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: '17px',
                              color: '#0f172a',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ฿{displayPrice.toLocaleString()}
                          </div>
                        </div>

                        {/* Divider */}
                        <div
                          style={{
                            height: '1px',
                            background: '#f1f5f9',
                            marginBottom: '12px',
                          }}
                        />

                        {/* Bottom Row: "ดูตัวเลือกอื่น" + Actions */}
                        <div className="rec-card-footer rec-card-footer-s1">
                          {/* Left (Desktop) / Bottom (Mobile 100%): Button "ดูตัวเลือกอื่น" */}
                          {item.variants.length > 0 ? (
                            <button
                              type="button"
                              className="rec-card-variant-btn"
                              onClick={() => toggleVariantDropdown(item.id)}
                              style={{
                                background: isExpanded ? '#ccfbf1' : '#f0fdfa',
                              }}
                            >
                              <span>ดูตัวเลือกอื่น</span>
                              <span
                                style={{
                                  background: '#0d9488',
                                  color: '#ffffff',
                                  borderRadius: '10px',
                                  padding: '1px 6px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                {item.variants.length}
                              </span>
                              {isExpanded ? (
                                <ChevronUp size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )}
                            </button>
                          ) : (
                            <div />
                          )}

                          {/* Right (Desktop) / Top (Mobile 50% 50%): Buttons "สนใจ" and "แนะนำ" */}
                          <div className="rec-card-status-btns">
                            {/* Button สนใจ */}
                            <button
                              type="button"
                              onClick={() => handleToggleMainInterest(item.id)}
                              style={{
                                padding: '6px 14px',
                                borderRadius: '8px',
                                border: status.interested
                                  ? '1.5px solid #0abab5'
                                  : '1px solid #0abab5',
                                background: status.interested ? '#0abab5' : '#ffffff',
                                color: status.interested ? '#ffffff' : '#0abab5',
                                fontWeight: 600,
                                fontSize: '13px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {status.interested ? (
                                <Check size={14} />
                              ) : (
                                <ShoppingBag size={14} />
                              )}
                              <span>
                                {status.interested ? 'สนใจแล้ว' : 'สนใจ'}
                              </span>
                            </button>

                            {/* Button แนะนำ */}
                            <button
                              type="button"
                              onClick={() => handleToggleMainRecommend(item.id)}
                              style={{
                                padding: '6px 14px',
                                borderRadius: '8px',
                                border: status.recommended
                                  ? '1.5px solid #0abab5'
                                  : '1px solid #cbd5e1',
                                background: status.recommended ? '#f0fdfa' : '#ffffff',
                                color: status.recommended ? '#0f766e' : '#475569',
                                fontWeight: 600,
                                fontSize: '13px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {status.recommended && <Check size={14} />}
                              <span>{status.recommended ? 'แนะนำแล้ว' : 'แนะนำ'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Dropdown / Accordion for Alternative Variants */}
                        {isExpanded && (
                          <div
                            style={{
                              marginTop: '12px',
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: '8px',
                              padding: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '11.5px',
                                fontWeight: 600,
                                color: '#64748b',
                                padding: '2px 8px 4px',
                              }}
                            >
                              เลือกรุ่น / สีที่ต้องการแทนที่:
                            </div>
                            {item.variants.map((v) => {
                              const isSelected = activeVariant?.skuCode === v.skuCode;
                              return (
                                <div
                                  key={v.skuCode}
                                  onClick={() => handleSelectVariant(item.id, v)}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    background: isSelected ? '#e6f7f6' : '#ffffff',
                                    border: isSelected
                                      ? '1.5px solid #0abab5'
                                      : '1px solid #e2e8f0',
                                    cursor: 'pointer',
                                    transition: 'all 0.1s ease',
                                  }}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span
                                      style={{
                                        fontSize: '13px',
                                        fontWeight: isSelected ? 600 : 500,
                                        color: isSelected ? '#0f766e' : '#1e293b',
                                      }}
                                    >
                                      {v.name}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        color: '#64748b',
                                      }}
                                    >
                                      {v.skuCode}
                                    </span>
                                  </div>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        color: '#0f172a',
                                      }}
                                    >
                                      ฿{v.price.toLocaleString()}
                                    </span>
                                    {isSelected && (
                                      <Check size={14} color="#0abab5" />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SECTION 2: เสนอสินค้าเพิ่มเติม (Ecosystem) */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '18px 20px',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <Sparkles size={18} color="#0abab5" />
            <h3
              style={{
                margin: 0,
                fontSize: '15.5px',
                fontWeight: 700,
                color: '#0f172a',
              }}
            >
              2. เสนอสินค้าเพิ่มเติม (Ecosystem)
            </h3>
          </div>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '12.5px',
              color: '#64748b',
            }}
          >
            สอบถามและนำเสนออุปกรณ์ใน Ecosystem ของ Apple พร้อมบันทึกสถานะของลูกค้า
          </p>
        </div>

        {/* List of Additional Ecosystem Items */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {additionalItems.map((item, idx) => {
            const activeVariant = selectedVariants[item.id];
            const isExpanded = Boolean(expandedVariants[item.id]);
            const current = additionalItemState[item.id] || {
              recommended: false,
              status: 'NONE',
            };
            const currentStatus = current.status;
            const isRecommended =
              current.recommended ||
              currentStatus === 'OWNED' ||
              currentStatus === 'OLD_MODEL' ||
              currentStatus === 'INTERESTED';
            const displayName = activeVariant?.name || item.name;
            const displayPrice = activeVariant?.price ?? item.price;
            const displaySku = activeVariant?.skuCode || item.skuCode;

            return (
              <div
                key={item.id}
                style={{
                  background:
                    currentStatus === 'INTERESTED'
                      ? '#f0fdfa'
                      : currentStatus !== 'NONE' || isRecommended
                        ? '#f8fafc'
                        : '#ffffff',
                  border:
                    currentStatus === 'INTERESTED'
                      ? '2px solid #0abab5'
                      : currentStatus !== 'NONE' || isRecommended
                        ? '1.5px solid #0abab5'
                        : '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Top: Circle badge + Category & Brand & SKU */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '10px',
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: '#eff6ff',
                      color: '#2563eb',
                      fontWeight: 700,
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div
                    style={{
                      fontSize: '12.5px',
                      color: '#64748b',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{item.category}</span>
                    <span>•</span>
                    <span style={{ fontWeight: 600, color: '#334155' }}>
                      {item.brand}
                    </span>
                    <span
                      style={{
                        background: '#f1f5f9',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: '#64748b',
                      }}
                    >
                      {displaySku}
                    </span>
                  </div>
                </div>

                {/* Middle: Product Title + Price */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                    marginBottom: '14px',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '14.5px',
                      color: '#0f172a',
                      lineHeight: '1.4',
                      flex: 1,
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '17px',
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ฿{displayPrice.toLocaleString()}
                  </div>
                </div>

                {/* Divider */}
                <div
                  style={{
                    height: '1px',
                    background: '#f1f5f9',
                    marginBottom: '12px',
                  }}
                />

                {/* Bottom Row: "ดูตัวเลือกอื่น" + 4 Status Actions */}
                <div className="rec-card-footer rec-card-footer-s2">
                  {/* Left (Desktop) / Bottom (Mobile 100%): Button "ดูตัวเลือกอื่น" */}
                  <div className="rec-s2-left">
                    {item.variants && item.variants.length > 0 ? (
                      <button
                        type="button"
                        className="rec-card-variant-btn"
                        onClick={() => toggleVariantDropdown(item.id)}
                        style={{
                          background: isExpanded ? '#ccfbf1' : '#f0fdfa',
                        }}
                      >
                        <span>ดูตัวเลือกอื่น</span>
                        <span
                          style={{
                            background: '#0d9488',
                            color: '#ffffff',
                            borderRadius: '10px',
                            padding: '1px 6px',
                            fontSize: '11px',
                            fontWeight: 700,
                          }}
                        >
                          {item.variants.length}
                        </span>
                        {isExpanded ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                    ) : (
                      <div />
                    )}
                  </div>

                  {/* Right (Desktop) / Top & Mid (Mobile 50% 50%): 4 status buttons */}
                  <div className="rec-s2-right">
                    {/* Row 1 on Mobile: มีอยู่แล้ว (50%) + ใช้รุ่นเก่าอยู่ (50%) */}
                    <div className="rec-s2-row-mid">
                      {/* มีอยู่แล้ว */}
                      <button
                        type="button"
                        onClick={() => handleSetAdditionalStatus(item.id, 'OWNED')}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border:
                            currentStatus === 'OWNED'
                              ? '1.5px solid #64748b'
                              : '1px solid #cbd5e1',
                          background:
                            currentStatus === 'OWNED' ? '#f1f5f9' : '#ffffff',
                          color: currentStatus === 'OWNED' ? '#0f172a' : '#64748b',
                          fontWeight: 600,
                          fontSize: '12.5px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {currentStatus === 'OWNED' && <Check size={13} />}
                        <span>มีอยู่แล้ว</span>
                      </button>

                      {/* ใช้รุ่นเก่าอยู่ */}
                      <button
                        type="button"
                        onClick={() =>
                          handleSetAdditionalStatus(item.id, 'OLD_MODEL')
                        }
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border:
                            currentStatus === 'OLD_MODEL'
                              ? '1.5px solid #d97706'
                              : '1px solid #cbd5e1',
                          background:
                            currentStatus === 'OLD_MODEL' ? '#fffbeb' : '#ffffff',
                          color:
                            currentStatus === 'OLD_MODEL' ? '#b45309' : '#64748b',
                          fontWeight: 600,
                          fontSize: '12.5px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {currentStatus === 'OLD_MODEL' && <Check size={13} />}
                        <span>ใช้รุ่นเก่าอยู่</span>
                      </button>
                    </div>

                    {/* Row 2 on Mobile: สนใจ (50%) + แนะนำ (50%)*/}
                    <div className="rec-s2-row-top">
                      {/* สนใจ */}
                      <button
                        type="button"
                        onClick={() =>
                          handleSetAdditionalStatus(item.id, 'INTERESTED')
                        }
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border:
                            currentStatus === 'INTERESTED'
                              ? '1.5px solid #0abab5'
                              : '1px solid #0abab5',
                          background:
                            currentStatus === 'INTERESTED'
                              ? '#0abab5'
                              : '#ffffff',
                          color:
                            currentStatus === 'INTERESTED'
                              ? '#ffffff'
                              : '#0abab5',
                          fontWeight: 600,
                          fontSize: '12.5px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {currentStatus === 'INTERESTED' ? (
                          <Check size={13} />
                        ) : (
                          <ShoppingBag size={13} />
                        )}
                        <span>
                          {currentStatus === 'INTERESTED' ? 'สนใจแล้ว' : 'สนใจ'}
                        </span>
                      </button>

                      {/* แนะนำ */}
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleAdditionalRecommend(item.id)
                        }
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border:
                            isRecommended
                              ? '1.5px solid #0abab5'
                              : '1px solid #cbd5e1',
                          background:
                            isRecommended
                              ? '#f0fdfa'
                              : '#ffffff',
                          color:
                            isRecommended
                              ? '#0f766e'
                              : '#475569',
                          fontWeight: 600,
                          fontSize: '12.5px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {isRecommended && <Check size={13} />}
                        <span>
                          {isRecommended
                            ? 'แนะนำแล้ว'
                            : 'แนะนำ'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Dropdown / Accordion for Alternative Variants */}
                {isExpanded && item.variants && (
                  <div
                    style={{
                      marginTop: '12px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#64748b',
                        padding: '2px 8px 4px',
                      }}
                    >
                      เลือกรุ่น / สีที่ต้องการแทนที่:
                    </div>
                    {item.variants.map((v) => {
                      const isSelected = activeVariant?.skuCode === v.skuCode;
                      return (
                        <div
                          key={v.skuCode}
                          onClick={() => handleSelectVariant(item.id, v)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            background: isSelected ? '#e6f7f6' : '#ffffff',
                            border: isSelected
                              ? '1.5px solid #0abab5'
                              : '1px solid #e2e8f0',
                            cursor: 'pointer',
                            transition: 'all 0.1s ease',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: isSelected ? 600 : 500,
                                color: isSelected ? '#0f766e' : '#1e293b',
                              }}
                            >
                              {v.name}
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                color: '#64748b',
                              }}
                            >
                              {v.skuCode}
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#0f172a',
                              }}
                            >
                              ฿{v.price.toLocaleString()}
                            </span>
                            {isSelected && (
                              <Check size={14} color="#0abab5" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions Desktop */}
      <div
        className="desktop-actions"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '8px',
        }}
      >
        <div style={{ fontSize: '13px', color: '#64748b' }}>
          {recommendedCount > 0 || interestedCount > 0 ? (
            <span>
              แนะนำ {recommendedCount} รายการ •{' '}
              <strong style={{ color: '#0abab5' }}>
                สนใจ {interestedCount} รายการ
              </strong>
            </span>
          ) : (
            <span>ไม่บังคับเลือก สามารถกดถัดไปเพื่อดำเนินการต่อได้ทันที</span>
          )}
        </div>
        <Button variant="primary" onClick={handleConfirmStep} disabled={busy}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ถัดไป
            <ArrowRight size={16} />
          </span>
        </Button>
      </div>

      {/* Actions Mobile (Sticky Bottom Bar) */}
      <div className="mobile-sticky-bar">
        <Button
          variant="primary"
          onClick={handleConfirmStep}
          disabled={busy}
          style={{ width: '100%', minHeight: '46px' }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {interestedCount > 0 ? `ถัดไป (สนใจ ${interestedCount} ชิ้น)` : 'ถัดไป'}
            <ArrowRight size={16} />
          </span>
        </Button>
      </div>
    </div>
  );
}
