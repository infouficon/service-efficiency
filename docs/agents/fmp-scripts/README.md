# สคริปต์ FileMaker สำหรับรับออเดอร์จาก SES (v2, 2026-11-03)

ทีม FMP (KoB) ส่งสคริปต์ `ses` และ `ses_fail` มาให้ (2026-11-02) ทีม SES แก้ให้ตรงกับข้อมูลที่ SES ส่งจริงแล้ว และเพิ่มสคริปต์ใหม่
`ses_report_bill` สำหรับแจ้งเปิดบิลกลับมาที่ SES คำอธิบายภาพรวม: [../fmp-team-th.md](../fmp-team-th.md)

| ไฟล์ | คืออะไร |
| --- | --- |
| [ses_v2.txt](ses_v2.txt) | สคริปต์ `ses` เวอร์ชันใหม่ ทุกจุดที่เปลี่ยนมี `[SES v2]` นำหน้า |
| [ses_fail_v2.txt](ses_fail_v2.txt) | สคริปต์ `ses_fail` เวอร์ชันใหม่ (เปลี่ยน 1 บรรทัด) |
| [ses_report_bill.txt](ses_report_bill.txt) | **ใหม่** แจ้ง SES ว่าเปิดบิลแล้ว → ออเดอร์ใน SES เป็น "เปิดบิลแล้ว" |
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

## สิ่งที่เปลี่ยนใน `ses_fail`

`If [ Get ( FoundCount ) = 1 ]` → `If [ Get ( FoundCount ) ≥ 1 ]` (ใช้ record ปัจจุบัน) กันกรณีมีหลาย record

## สคริปต์ใหม่ `ses_report_bill`

เรียกตอนออกบิลจริงจากบิลพักที่มาจาก SES (`pos_front_sale_tmp::ses_id` ไม่ว่าง) Parameter `{ "sesID": "...", "billNo": "..." }`
สคริปต์เรียก `POST https://ses.uficon.com/api/integrations/pos/bills` ด้วยคีย์ `POS_API_KEY` (ขอจากเจ้าของระบบ SES เก็บไว้ในฟิลด์ที่จำกัดสิทธิ์
ห้ามเขียนลงสคริปต์) ต้องส่ง User-Agent ที่ไม่ใช่ของ curl เพราะ Cloudflare ตอบ 403 กับ user-agent ของ curl (ใส่ไว้ในสคริปต์แล้ว)

## ที่ทีม FMP ยังต้องตัดสินใจ / เติม

1. label ของ PayBy สำหรับ `Trade In`, `U-Joy`, `Partner Mall`, `อื่นๆ` (ไม่เติม = ใช้ข้อความภาษาไทยตามที่ SES ส่ง)
2. ค่า `$ALLOW_UNKNOWN_CUSTOMER` และ `$ALLOW_NO_PAYMENT` (ตั้งเป็น 1 ให้แล้ว เปลี่ยนเป็น 0 ได้ถ้าต้องการปฏิเสธแบบเดิม)
3. บิลพักเดิมเมื่อแคชเชียร์ตีกลับ: สคริปต์ตอบ `ALREADY_DONE` และ SN ชุดใหม่ไม่ถูกใช้ (SES แสดงเป็น error) ทีม FMP ต้องยกเลิกบิลพักเดิมเอง
   แล้วตั้ง `ses_status` เป็นว่าง จากนั้น ADMIN ของ SES กด "ส่งซ้ำ"
4. ทำ index ให้ `ProductStore_detail::product_sn` (SES รอคำตอบได้ไม่เกิน 60 วินาที)
5. จุดที่จะเรียก `ses_report_bill` ในขั้นตอนออกบิลของ FMP
