FMP SES Script UPDATE 2026-11-10  (ses v3.3 + ses_fail v3 + ses_report_bill v3)
=====================================================================
เพิ่มอย่างเดียว: ผลลัพธ์ของสคริปต์ ses มี "snCheck" = ผลตรวจ SN ทีละเครื่อง
ไม่เปลี่ยนการตรวจ SN เดิม ไม่เปลี่ยนการเขียนบิล ไม่ query เพิ่ม (ใช้ $snRow ที่ดึงไว้แล้ว)
ทุกจุดที่เพิ่มมี [SES v3.3] (ใน ses) / [SES v3] (ใน ses_fail) นำหน้า

ทำไม
- ตอนนี้ SES รู้แค่ "CREATED (1 รายการ)" หรือ error ตัวแรก ไม่รู้ว่าแต่ละ SN เป็นอย่างไร
- มี snCheck แล้ว SES จะ: แสดงให้ Stock เห็นว่าเครื่องไหนผิด (รุ่นไม่ตรง / อยู่สาขาอื่น / ขายแล้ว)
  ส่งกลับให้ Stock สแกนใหม่เฉพาะเครื่องที่ผิด และแสดงชื่อ/รุ่นจริงตามที่ FMP บันทึก

แก้ 5 จุด (เรียงตามลำดับในสคริปต์ ses)
1) 0. Config  ต่อจาก  Set Variable [ $snLaterMsg ; Value: "" ]
     Set Variable [ $snCheck ; Value: "[]" ]
     Set Variable [ $k ; Value: 0 ]

2) Loop ใน : sn  หลัง End If ของชุดตรวจ (ต่อจาก SN_ALREADY_SOLD_OR_HELD)
   และ "ก่อน" บรรทัด  # [SES v3] FMP ยังไม่มีเครื่องนี้ในสาขานี้ ...  (ต้องอยู่ก่อน เพราะส่วนนั้นล้าง $errCode)
     Set Variable [ $snCheck ; Value: JSONSetElement ( $snCheck ; "[" & $k & "]" ; JSONSetElement ( "{}" ;
        [ "sn" ; $sn ; JSONString ] ;
        [ "partNo" ; $partNo ; JSONString ] ;
        [ "found" ; not IsEmpty ( $snRow ) and $snRow ≠ "?" ; JSONBoolean ] ;
        [ "written" ; IsEmpty ( $errCode ) ; JSONBoolean ] ;
        [ "code" ; $errCode ; JSONString ] ;
        [ "model" ; $snModel ; JSONString ] ;
        [ "upc" ; $snUPC ; JSONString ] ;
        [ "status" ; $snStatus ; JSONString ] ;
        [ "branch" ; $snBcode ; JSONString ] ;
        [ "name" ; GetValue ( $snRow ; 15 ) ; JSONString ] ;
        [ "price" ; If ( IsEmpty ( $snPrice ) ; "null" ; $snPrice ) ; JSONRaw ] ) ; JSONObject ) ]
     Set Variable [ $k ; Value: $k + 1 ]

3) Perform Script [ "ses_fail" ] หลังจบ single-pass (If [ not IsEmpty ( $errCode ) ])
   เพิ่มใน Parameter:   ; [ "snCheck" ; $snCheck ; JSONArray ]

4) Perform Script [ "ses_fail" ] ตอน TRANSACTION_FAILED
   เพิ่มใน Parameter:   ; [ "snCheck" ; $snCheck ; JSONArray ]

5) Exit Script สุดท้าย (CREATED / CREATED_SN_LATER)
   เพิ่มท้าย JSONSetElement:   ; [ "snCheck" ; $snCheck ; JSONArray ]

สคริปต์ ses_fail (2 จุด)
a) ต่อจาก  Set Variable [ $msg ; Value: JSONGetElement ( $p ; "message" ) ]
     Set Variable [ $snCheck ; Value: JSONGetElement ( $p ; "snCheck" ) ]
b) Exit Script เพิ่มท้าย:   ; [ "snCheck" ; If ( IsEmpty ( $snCheck ) ; "[]" ; $snCheck ) ; JSONArray ]

ผลที่ SES จะได้ (ตัวอย่าง)
{"ok":true,"code":"CREATED_SN_LATER","lines":1,"snPending":1, ... ,
 "snCheck":[
  {"sn":"357773497214420","partNo":"MJY04ZP/A","found":true,"written":true,"code":"",
   "model":"MJY04ZP/A","upc":"195951413808","status":"ready","branch":"ISTA","name":"AirPods Pro 2","price":8990},
  {"sn":"358085301986500","partNo":"MJY04ZP/A","found":true,"written":false,"code":"SN_WRONG_BRANCH",
   "model":"MJY04ZP/A","upc":"195951413808","status":"ready","branch":"ISTM","name":"AirPods Pro 2","price":8990}
 ]}

หมายเหตุ
- ถ้าออเดอร์ล้ม (เช่น SN_MODEL_MISMATCH) snCheck มีเครื่องที่ตรวจแล้วจนถึงเครื่องที่ล้ม เครื่องหลังจากนั้นยังไม่ได้ตรวจ (เหมือนเดิม)
- ถ้า product_name ไม่ได้อยู่คอลัมน์ 15 ของ $snRow แล้ว ให้แก้เลขใน "name" ให้ตรง
- SES รับ snCheck ได้ตั้งแต่ตอนนี้ (ยังไม่มีก็ไม่พัง) ทดสอบได้ทันทีที่แก้เสร็จ: ส่งออเดอร์ทดสอบ 1 รายการแล้วบอกทีม SES


=====================================================================
ses_report_bill v3  (ไฟล์ ses_report_bill_v3.txt)
=====================================================================
คุณกบแจ้ง (2026-11-10): FMP มีเลขที่บิลตอนกดชำระเงินเท่านั้น ตอนเปิดบิลยังไม่มีเลขบิล -> ตกลงตามนี้
- เรียก ses_report_bill ครั้งเดียว ท้ายสคริปต์ชำระเงิน/ออกใบเสร็จ
- param: { "sesID": ses::ses_id, "billNo": <เลขที่บิล>, "paid": 1, "openedAt": <เวลาที่เปิดบิลพัก> }
  openedAt แนะนำ ses::processed_at (เวลาที่สคริปต์ ses เปิดบิลพักให้) หรือเวลาสร้างบิลพักในตารางบิล
  เช่น JSONSetElement ( "{}" ; [ "sesID" ; ses::ses_id ; JSONString ] ; [ "billNo" ; <เลขบิล> ; JSONString ] ;
        [ "paid" ; 1 ; JSONNumber ] ; [ "openedAt" ; ses::processed_at ; JSONString ] )
- ต่างจาก v2: openedAt ใช้เวลาเปิดบิลพักจาก param (v2 ใช้เวลาตอนเรียก ซึ่งตอนชำระจะได้เวลาชำระ ผิด) ถ้าไม่ส่ง openedAt ใช้เวลาตอนเรียกแทน
- SES ปิดการขายตาม completedAt (เวลาชำระ) และเก็บเลขบิล
- ฝั่ง SES ปรับแล้ว: ออเดอร์ที่สคริปต์ ses ตอบ CREATED ถือว่า "FMP เปิดบิลพักแล้ว รอชำระ" ไม่ฟ้องว่ายังไม่เปิดบิล
- คีย์ POS_API_KEY อ่านจากฟิลด์ที่จำกัดสิทธิ์ (ไม่เขียนในสคริปต์)


=====================================================================
ses_report_cancel v1  (ไฟล์ ses_report_cancel_v1.txt) — ใหม่ 2026-11-10
=====================================================================
คุณกบถาม: ถ้ายกเลิกบิลจากฝั่ง FMP ต้องส่งอะไรหา SES ไหม -> ส่ง (สคริปต์นี้)
เหตุผล: ถ้าไม่แจ้ง SES จะยังเข้าใจว่าบิลพักเปิดอยู่ (หรือขายไปแล้ว ถ้ายกเลิกหลังชำระ) ไม่มีใครรู้ว่าต้องส่งออเดอร์ใหม่

เรียกที่ไหน: ท้ายสคริปต์ยกเลิกบิลพักของ FMP เฉพาะบิลที่ pos_front_sale_tmp::ses_id ไม่ว่าง (หลังคืน SN ให้สแกนใหม่ได้แล้ว)
param: JSONSetElement ( "{}" ; [ "sesID" ; pos_front_sale_tmp::ses_id ; JSONString ] ; [ "saleID" ; <เลขบิลพัก> ; JSONString ] ;
       [ "reason" ; <เหตุผลที่ยกเลิก> ; JSONString ] ; [ "paid" ; <1 ถ้าชำระแล้ว ไม่งั้น 0> ; JSONNumber ] )

สคริปต์ทำ 2 อย่าง
1) ล้าง ses::ses_status และ ses::sale_id ของ sesID นั้น (เขียนเหตุผลไว้ใน ses::ses_error)
   จำเป็น: สคริปต์ ses ตอบ ALREADY_DONE ทันทีถ้า ses_status = "DONE" ถ้าไม่ล้าง SES ส่งออเดอร์เดิมซ้ำแล้ว FMP จะไม่เปิดบิลใหม่
   ถ้าสคริปต์ยกเลิกของ FMP ล้างสองฟิลด์นี้อยู่แล้ว ลบขั้น 1 ออกได้
   ยกเลิกหลังชำระ (paid = 1) ไม่ล้าง เพราะ SES ปิดการขายไปแล้ว
2) ยิง callback  POST https://ses.uficon.com/api/integrations/fmp/callback
   ใช้คีย์ FMP_CALLBACK_KEY ตัวเดียวกับที่ยิงทดสอบเมื่อ 31 ต.ค. (อ่านจากฟิลด์ที่จำกัดสิทธิ์)
   body {"reference": <sesID>, "status": "error", "message": "CANCELLED saleID <เลขบิลพัก>: <เหตุผล>", "time": <เวลายกเลิก +07:00>}
   ได้ 200 = SES รับแล้ว

ผลฝั่ง SES (ไม่ต้องแก้อะไรเพิ่ม)
- ออเดอร์ขึ้นในแผง "ออเดอร์ที่ต้องดู" เป็น "FMP แจ้งผิดพลาด" พร้อมข้อความ CANCELLED และปุ่ม "ส่งซ้ำ"
- พนักงานกดส่งซ้ำ -> SES ส่ง sesID เดิม SN เดิมมาใหม่ -> สคริปต์ ses เปิดบิลพักใหม่
  หรือถ้าลูกค้าไม่ซื้อแล้ว พนักงานยกเลิกออเดอร์ใน SES

ยกเลิกจากฝั่ง SES (ออเดอร์ถูกยกเลิกใน SES หลังส่งถึงแคชเชียร์แล้ว)
- ตอนนี้ SES ยังไม่ส่งอะไรมา FMP ไม่ต้องเขียนสคริปต์เพิ่ม
- รอบแรกให้แคชเชียร์ยกเลิกบิลพักใน FMP เอง ถ้าเจอบ่อยค่อยคุยกันทำแบบอัตโนมัติ
