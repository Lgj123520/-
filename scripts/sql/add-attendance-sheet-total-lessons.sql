-- 上传表格中「总课时」列按行保存；为空时界面与统计仍使用班级 classes.total_lessons
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS sheet_total_lessons integer;

COMMENT ON COLUMN attendance_records.sheet_total_lessons IS '点名表该行「总课时」；NULL 表示未从表识别，使用班级总课时';
