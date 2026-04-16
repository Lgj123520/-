import { pgTable, serial, timestamp, varchar, boolean, integer, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 班级表 - 存储班级信息
export const classes = pgTable(
	"classes",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		name: varchar("name", { length: 255 }).notNull(), // 班级名称，如"寒假一班"
		term: varchar("term", { length: 50 }).notNull(), // 学期，如"寒假"、"春季"
		total_lessons: integer("total_lessons").notNull().default(12), // 总课时数
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("classes_term_idx").on(table.term), // 按学期索引
		index("classes_user_idx").on(table.user_id),
	]
);

// 学生表 - 存储学生基本信息
export const students = pgTable(
	"students",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		name: varchar("name", { length: 128 }).notNull(), // 学生姓名
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("students_name_idx").on(table.name), // 按姓名索引便于查询
	]
);

// 点名记录表 - 存储每个班级每个学生的点名信息
export const attendanceRecords = pgTable(
	"attendance_records",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		class_id: varchar("class_id", { length: 36 }).notNull().references(() => classes.id),
		student_id: varchar("student_id", { length: 36 }).notNull().references(() => students.id),
		lessons_attended: integer("lessons_attended").notNull().default(0), // 已上课时数
		is_half_free: boolean("is_half_free").notNull().default(false), // 是否半免
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("attendance_class_idx").on(table.class_id), // 按班级索引
		index("attendance_student_idx").on(table.student_id), // 按学生索引
		index("attendance_class_student_idx").on(table.class_id, table.student_id), // 复合索引
	]
);
