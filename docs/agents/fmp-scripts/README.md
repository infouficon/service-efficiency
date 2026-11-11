# สคริปต์ FileMaker สำหรับรับออเดอร์จาก SES (v3.3, 2026-11-10)

ทีม FMP (KoB) ส่งสคริปต์ `ses` และ `ses_fail` มาให้ (2026-11-02) ทีม SES แก้ให้ตรงกับข้อมูลที่ SES ส่งจริงแล้ว และเพิ่มสคริปต์ใหม่
`ses_report_bill` สำหรับแจ้งเปิดบิลกลับมาที่ SES คำอธิบายภาพรวม: [../fmp-team-th.md](../fmp-team-th.md)

## สถานะที่ทีม FMP ใช้งานจริง (ตรวจจาก export 2026-11-06)

| สคริปต์ | ใช้งานจริง | ยังต้องแก้ |
| --- | --- | --- |
| `ses_fail` | v2 ตรงทุกบรรทัด | — |
| `ses` | v3.1 + ทีม FMP เพิ่มเอง 3 จุด (มี `[SES v3.2]` นำหน้าใน `ses_v3.txt`): รหัสสาขาของ SN เป็นคอลัมน์ 14 ของ `$snRow` (product_name ย้ายไป 15), ข้อความ `SN_WRONG_BRANCH` บอกรหัสสาขา, เขียนเฉพาะบรรทัดที่มี SN | 3.3 Payments อ่าน `payments` 3 ที่ (`If`, `$payCnt`, `$payby`) ต้องเป็น **`paymentTypes`**: `payments` คือชื่อช่องทางของ SES (Cash, Transfer, Full Credit Card…) ไม่ตรงกับ Substitute ภาษาไทย PayBy ในบิลพักจึงได้ชื่อดิบ |
| `ses_report_bill` | v1 (แจ้งเปิดบิลอย่างเดียว เรียกท้ายสคริปต์ออกใบเสร็จ) | ใช้ v2: ใส่ `"paid": 1` → SES ปิดการขายตามเวลาที่ชำระ (ตอนนี้ออเดอร์หยุดที่ "เปิดบิลแล้ว" ADMIN ต้องปิดเอง) · คีย์ถูกเขียนไว้ในตัวสคริปต์ ควรย้ายไปฟิลด์ที่จำกัดสิทธิ์ |

สำเนาที่ทีม FMP ส่งมา: `ses_v3_live_from_fmp.txt` (ไม่เก็บสำเนา `ses_report_bill` เพราะมีคีย์อยู่ในตัวสคริปต์)

| ไฟล์ | คืออะไร |
| --- | --- |
| [ses_v3.3.txt](ses_v3.3.txt) | **ล่าสุด (v3.3 2026-11-10)** = v3.2 + ผลลัพธ์มี `snCheck` (ผลตรวจ SN ทีละเครื่อง) ทุกจุดมี `[SES v3.3]` นำหน้า วิธีแก้ทีละ step: [README-v3.3-TH.txt](README-v3.3-TH.txt) |
| [ses_fail_v3.txt](ses_fail_v3.txt) | `ses_fail` v3 = v2 + คืน `snCheck` ที่ `ses` ส่งมา (2 บรรทัด) |
| [ses_v3.txt](ses_v3.txt) | **ล่าสุด (v3.2 2026-11-06)** สคริปต์ `ses` = ตัวที่ทีม FMP ใช้งานจริง + แก้ 3.3 Payments ให้อ่าน `paymentTypes` (v3 = v2 + "สแกน SN ทีหลัง" มี `[SES v3]` นำหน้า, ที่ทีม FMP แก้เพิ่มมี `[SES v3.2]`) |
| [ses_v3_live_from_fmp.txt](ses_v3_live_from_fmp.txt) | ตัวที่ทีม FMP ใช้งานจริง (export 2026-11-06, ไว้เทียบ) |
| [ses_v2.txt](ses_v2.txt) | สคริปต์ `ses` v2 ทุกจุดที่เปลี่ยนจากต้นฉบับมี `[SES v2]` นำหน้า |
| [ses_fail_v2.txt](ses_fail_v2.txt) | สคริปต์ `ses_fail` เวอร์ชันใหม่ (เปลี่ยน 1 บรรทัด) |
| **ชุด v4.2 (ล่าสุด 2026-11-11, D129)** ไฟล์ชุดเดิม `ses_v4.txt` เป็น v4.2 แล้ว: ร่างหายไม่วนติด `BILL_CONFIRMED` (ดูบิลจริงตาม `ses_id`), `PROCESSING` หมดเวลา 5 นาที, กันชนส่งกลับ STOCK (`IN_PROGRESS` SES ส่งซ้ำเอง), SQL error ไม่เดา, เช็คชื่อฟิลด์หมายเหตุ, บัตร/เดือนผ่อน/ใบเสร็จลงหมายเหตุ |  |
| **ชุด v4 (2026-11-10, D126)** [README-v4-TH.txt](README-v4-TH.txt) · [ses_v4.txt](ses_v4.txt) · [ses_fail_v4.txt](ses_fail_v4.txt) · [ses_report_bill_v4.txt](ses_report_bill_v4.txt) · [ses_report_cancel_v4.txt](ses_report_cancel_v4.txt) | ใช้แทน v3.x ทั้งหมด: v3.4 (เอาบิลพักออก/แก้ไขครั้งที่ N) + PayBy ตามชื่อช่องทาง SES (`$PAYBY_MAP`) · ต้องเพิ่มฟิลด์ `ses::ses_rev`, `pos_front_sale_tmp::ses_note` |
| [ses_v3.4.txt](ses_v3.4.txt) | **ล่าสุด (v3.4 2026-11-10, D123)** ส่งกลับ STOCK / ยกเลิกใน SES = เอาบิลพักออก (ปล่อย SN) · ส่งรอบใหม่ = เปิดบิลพักใหม่ หมายเหตุ "แก้ไขครั้งที่ N" · ต้องเพิ่มฟิลด์ `ses::ses_rev`, `pos_front_sale_tmp::ses_note` · อ่าน [README-v3.4-TH.txt](README-v3.4-TH.txt) |
| [ses_report_cancel_v1.txt](ses_report_cancel_v1.txt) | **ใหม่ (v1 2026-11-10, D121)** เรียกท้ายสคริปต์ยกเลิกบิลพักของ FMP: ล้าง `ses_status`/`sale_id` (ส่งซ้ำแล้วเปิดบิลใหม่ได้) + แจ้ง SES ผ่าน callback `status: "error"` ข้อความ `CANCELLED ...` |
| [ses_report_bill_v3.txt](ses_report_bill_v3.txt) | **ล่าสุด (v3 2026-11-10)** FMP มีเลขบิลตอนชำระเท่านั้น: เรียกครั้งเดียวตอนชำระ `"paid": 1` + `"openedAt"` = เวลาเปิดบิลพัก (เช่น `ses::processed_at`) |
| [ses_report_bill.txt](ses_report_bill.txt) | **ใหม่ (v2 2026-11-04)** แจ้ง SES ว่าเปิดบิลแล้ว และว่าชำระเงินเสร็จแล้ว (`"paid": 1`) ด้วยเวลาจริงของ FMP |
| `ses_v1_from_fmp.txt`, `ses_fail_v1_from_fmp.txt` | ต้นฉบับที่ทีม FMP ส่งมา (ไว้เทียบ) |

ไฟล์เป็นข้อความจากการ export ของ FileMaker วางกลับเข้า Script Workspace ตรงๆ ไม่ได้ ให้แก้ทีละ step ตามรายการด้านล่าง
บรรทัดที่ FileMaker ตัดทอนตอน export (มี `…`) **ไม่ต้องแก้** ใช้สูตรเดิมในไฟล์ FileMaker (`$createdAt` และ SQL ของ `$snRow`)

## สิ่งที่เปลี่ยนในสคริปต์ `ses` (เรียงตามลำดับในสคริปต์)

| # | ส่วน | เดิม | ใหม่ (v2) | ทำไม |
| --- | --- | --- | --- | --- |
| 1 | 0. Config | — | เพิ่ม `$ALLOW_UNKNOWN_CUSTOMER = 1`, `$ALLOW_NO_PAYMENT = 1`, `$warnings = ""` | ให้ทีม FMP เลือกได้ว่าจะเข้มแค่ไหน ค่า 1 = เปิดบิลพักได้แล้วให้แคชเชียร์เติมเอง |
| 2 | 1. ค้นหา record | `FoundCount ≠ 1` → `NOT_FOUND` | ไม่เจอเลย → `NOT_FOUND` · เจอมากกว่า 1 → ใช้ record ล่าสุด (omit ตัวอื่น) | SES เก็บ 1 record ต่อออเดอร์อยู่แล้ว นี่คือกันไว้อีกชั้น |
| 3 | 3.2 Header | `staffId` ใช้ตรงๆ | ไม่พบในตาราง `staff` → เว้นว่าง + เตือน `UNKNOWN_STAFF` | บัญชีที่สร้างเองใน SES (เช่น `0001`) ไม่ใช่รหัสพนักงาน ERP |
| 4 | 3.2 ลูกค้า | ไม่พบเบอร์ → `WRONG_PHONE` | ไม่พบเบอร์ → เปิดบิลพักโดยไม่ผูกลูกค้า + เตือน `NEW_CUSTOMER` (ถ้า `$ALLOW_UNKNOWN_CUSTOMER = 1`) | ลูกค้าใหม่ของ SES ยังไม่มีใน FMP |
| 5 | 3.3 Payments | อ่าน `payments` แล้ว Substitute คำอังกฤษ | อ่าน **`paymentTypes`** แล้ว Substitute ภาษาไทย → PayBy ของ FMP | `payments` เป็นชื่อช่องทางของ SES (ADMIN เพิ่มได้เรื่อยๆ) การแปลงคำอังกฤษได้ค่าผิด |
| 6 | 3.3 Payments | ไม่มีวิธีชำระ → `NO_PAYMEN` | เปิดบิลพักได้ PayBy ว่าง + เตือน `NO_PAYMENT` (ถ้า `$ALLOW_NO_PAYMENT = 1`) | SES ไม่บังคับเลือกวิธีชำระ |
| 7 | 3.4 Accessories | มีอุปกรณ์เสริม → `ACCESSORIES_NOT_SUPPORTED` | ลบการตรวจ (เหลือคำอธิบาย) | ตกลงแล้ว: หน้าร้านเพิ่มอุปกรณ์เสริมเองใน FMP; SES ส่ง `accessories: []` และรายการอยู่ที่ `accessoriesForCashier` |
| 8 | 5. ผลลัพธ์ | `{ok, code, sesID, saleID, lines, payments}` | เพิ่ม `message` (คำเตือนภาษาไทย) และ `warnings` | SES แสดงผลนี้ในหน้า Admin เช่น `CREATED saleID … (1 รายการ): ลูกค้าใหม่ ยังไม่ผูกลูกค้าในบิล` |

ส่วนอื่นเหมือนเดิมทั้งหมด (สถานะ DONE/PROCESSING, version, state, test, สาขา, items, การตรวจ SN ทุกข้อ, การเขียนบิลใน transaction, `ses_fail`)

## สิ่งที่เพิ่มในสคริปต์ `ses` v3 (2026-11-05): "สแกน SN ทีหลัง"

เคส: เครื่องอยู่ที่ร้านแล้วแต่ FMP ยังไม่อัปเดต (เช่น โอนมาแล้วยังไม่รับโอน → `SN_WRONG_BRANCH`) v2 ปฏิเสธทั้งออเดอร์ v3 เปิดบิลพักได้
(**v3.1** ตามที่ทีม FMP ตอบ 2026-11-05: เครื่องนั้นข้าม ไม่เขียนบรรทัด เพราะช่อง SN เป็นช่องหลังบ้านที่แคชเชียร์กรอกไม่ได้)

| # | ส่วน | v2 | v3 | ทำไม |
| --- | --- | --- | --- | --- |
| 1 | 0. Config | — | เพิ่ม `$ALLOW_SN_LATER = 1`, `$snPending = 0`, `$snLaterMsg = ""` | 0 = ปฏิเสธแบบ v2 |
| 2 | 3.x เช็คจำนวน sn | `sn` ต้อง = `quantity` | `sn` น้อยกว่า `quantity` ได้ (เครื่องที่ขาดข้ามไป) มากกว่าไม่ได้ | SES ส่ง `snMissing` เมื่อ STOCK เลือก "ส่งโดย SN ยังไม่ครบ" |
| 3 | 3.x ตรวจ SN | `SN_NOT_FOUND` / `SN_WRONG_BRANCH` / `SN_NOT_READY_FOR_SALE` = ปฏิเสธ | 3 กรณีนี้ = ข้ามเครื่องนั้น + เหตุผลใน `message` · รุ่นไม่ตรง / ขายแล้ว / พักอยู่ / ซ้ำ ยังปฏิเสธ | FMP ยังไม่มีเครื่องนี้ในสาขานี้ ไม่ได้แปลว่าหยิบผิด |
| 4 | 4.2 รายการขาย | ทุกบรรทัดมี SN | ไม่เปลี่ยน: เขียนเฉพาะเครื่องที่ผ่าน ไม่มีบรรทัดว่าง · ข้ามทุกเครื่อง = บิลพักไม่มีบรรทัดสินค้า | แคชเชียร์สแกนขายเครื่องที่ขาดเพิ่มหน้าร้าน |
| 5 | 5. ผลลัพธ์ | `code: CREATED` | มีเครื่องที่ข้าม → `code: CREATED_SN_LATER`, เพิ่ม `snPending` | SES แสดงเป็นคำเตือนสีเหลือง |

เครื่องที่โอนมายังต้องรับโอนใน FMP ก่อนปิดบิล (สต็อกของ FMP ยังต้องถูก)

## สิ่งที่เปลี่ยนใน `ses_fail`

`If [ Get ( FoundCount ) = 1 ]` → `If [ Get ( FoundCount ) ≥ 1 ]` (ใช้ record ปัจจุบัน) กันกรณีมีหลาย record

## สคริปต์ใหม่ `ses_report_bill`

เรียกในบิลพักที่มาจาก SES (`pos_front_sale_tmp::ses_id` ไม่ว่าง) 2 จุด: ตอนเปิดบิลพักขึ้นมาทำรายการ Parameter `{ "sesID": "...", "billNo": "..." }`
→ SES "เปิดบิลแล้ว" และตอนชำระเงินเสร็จ Parameter `{ "sesID": "...", "billNo": "...", "paid": 1 }` → SES "ปิดการขาย" ตามเวลาที่ชำระ
(**v2, 2026-11-04**: เพิ่ม `paid`; เรียกได้จุดเดียวให้เรียกตอนชำระ) สคริปต์เรียก `POST https://ses.uficon.com/api/integrations/pos/bills` ด้วยคีย์ `POS_API_KEY` (ขอจากเจ้าของระบบ SES เก็บไว้ในฟิลด์ที่จำกัดสิทธิ์
ห้ามเขียนลงสคริปต์) ต้องส่ง User-Agent ที่ไม่ใช่ของ curl เพราะ Cloudflare ตอบ 403 กับ user-agent ของ curl (ใส่ไว้ในสคริปต์แล้ว)

## ที่ทีม FMP ยังต้องตัดสินใจ / เติม

1. label ของ PayBy สำหรับ `U-Joy`, `อื่นๆ` (ไม่เติม = ใช้ข้อความภาษาไทยตามที่ SES ส่ง; `Trade In` / `Partner Mall` ไม่ส่งแล้ว D105)
2. ค่า `$ALLOW_UNKNOWN_CUSTOMER` และ `$ALLOW_NO_PAYMENT` (ตั้งเป็น 1 ให้แล้ว เปลี่ยนเป็น 0 ได้ถ้าต้องการปฏิเสธแบบเดิม)
3. บิลพักเดิมเมื่อแคชเชียร์ตีกลับ: สคริปต์ตอบ `ALREADY_DONE` และ SN ชุดใหม่ไม่ถูกใช้ (SES แสดงเป็น error) ทีม FMP ต้องยกเลิกบิลพักเดิมเอง
   แล้วตั้ง `ses_status` เป็นว่าง จากนั้น ADMIN ของ SES กด "ส่งซ้ำ"
4. ทำ index ให้ `ProductStore_detail::product_sn` (SES รอคำตอบได้ไม่เกิน 60 วินาที)
5. จุดที่จะเรียก `ses_report_bill` ในขั้นตอนของ FMP: ตอนเปิดบิลพัก และตอนชำระเงินเสร็จ (`"paid": 1`) · ตอนนี้เรียกจุดเดียวท้ายสคริปต์ออกใบเสร็จ
   ซึ่งถูกตำแหน่งแล้ว เหลือใช้ v2 แล้วส่ง `"paid": 1` ทุกครั้ง
6. 3.3 Payments ของ `ses`: `payments` → `paymentTypes` (ดูสถานะด้านบน)
