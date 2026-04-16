# 续班率统计系统

## 项目简介

续班率统计系统用于教育培训行业，自动计算寒假→春季（或任意学期续班）的续班率。支持上传点名册、自动排除半免和上课不足1/3的学生。

## 核心功能

1. **点名册上传**：支持 Excel/CSV 格式，自动解析学生姓名、上课课时、备注状态
2. **续班率统计**：选择源学期（寒假）和目标学期（春季），自动计算续班率
3. **智能排除**：通过备注列识别，自动排除半免学生和上课课时不足总课时1/3的学生
4. **详细报表**：展示各班级明细、续读学生名单、未续班学生名单
5. **名单导出**：支持导出续读/未续班学生名单为 CSV 文件
6. **姓名匹配**：自动识别相似姓名（如"魏文煜"和"魏文钰"），支持手动匹配纠正
7. **班级管理**：支持预览班级学生、修改学生信息、删除班级、导出班级名单

## 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库**: Supabase (PostgreSQL)
- **Excel 解析**: xlsx

## 数据库表结构

### classes (班级表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键 UUID |
| name | varchar(255) | 班级名称，如"寒假一班" |
| term | varchar(50) | 学期，如"寒假"、"春季" |
| total_lessons | integer | 总课时数，默认12 |
| created_at | timestamp | 创建时间 |

### students (学生表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键 UUID |
| name | varchar(128) | 学生姓名 |
| created_at | timestamp | 创建时间 |

### attendance_records (点名记录表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键 UUID |
| class_id | varchar(36) | 关联班级 ID |
| student_id | varchar(36) | 关联学生 ID |
| lessons_attended | integer | 已上课时数 |
| is_half_free | boolean | 是否半免 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

## API 接口

### 上传点名册
```
POST /api/roster
Content-Type: multipart/form-data

参数：
- file: Excel/CSV 文件
- className: 班级名称
- term: 学期
- totalLessons: 总课时数（可选，默认12）

响应：
{
  "success": true,
  "data": {
    "class_name": "寒假一班",
    "term": "寒假",
    "total_lessons": 12,
    "student_count": 30
  }
}
```

### 获取班级列表
```
GET /api/roster

响应：
{
  "data": [
    {
      "id": "...",
      "name": "寒假一班",
      "term": "寒假",
      "total_lessons": 12,
      "student_count": 30,
      "created_at": "..."
    }
  ]
}
```

### 获取班级详情
```
GET /api/roster/{id}

响应：
{
  "data": {
    "class": {
      "id": "...",
      "name": "寒假一班",
      "term": "寒假",
      "total_lessons": 12,
      "created_at": "..."
    },
    "students": [
      {
        "id": "record_id",
        "student_id": "...",
        "name": "张三",
        "lessons_attended": 16,
        "is_excluded": false,
        "remark": ""
      }
    ]
  }
}
```

### 删除班级
```
DELETE /api/roster/{id}

响应：
{
  "success": true
}
```

### 计算续班率
```
POST /api/statistics
Content-Type: application/json

请求体：
{
  "fromTerm": "寒假",
  "toTerm": "春季"
}

响应：
{
  "data": {
    "from_term": "寒假",
    "to_term": "春季",
    "source_class_count": 3,
    "source_total_students": 85,
    "valid_students": 80,
    "renewed_students": 65,
    "not_renewed_students": 15,
    "renewal_rate": "81.3%",
    "class_stats": [...],
    "renewed_details": [...],
    "not_renewed_details": [...]
  }
}
```

### 查找相似姓名
```
POST /api/similar-names
Content-Type: application/json

请求体：
{
  "fromTerm": "寒假",
  "toTerm": "春季",
  "similarityThreshold": 0.6  // 可选，默认0.6
}

响应：
{
  "data": {
    "from_term": "寒假",
    "to_term": "春季",
    "total_similar": 2,
    "similar_names": [
      {
        "winter_student_id": "...",
        "winter_name": "魏文煜",
        "winter_class": "寒假一班",
        "spring_names": [
          { "student_id": "...", "name": "魏文钰", "similarity": 0.67 }
        ]
      }
    ]
  }
}
```

### 手动匹配姓名
```
POST /api/manual-match
Content-Type: application/json

请求体：
{
  "matches": [
    { "winterStudentId": "...", "springStudentId": "..." }
  ]
}

响应：
{
  "success": true,
  "data": {
    "total": 1,
    "success_count": 1,
    "results": [...]
  }
}
```

## 点名册文件格式

Excel/CSV 文件要求：
- 第一行：表头，包含姓名、课时数（或出勤次数）、备注
- 姓名列：必须填写
- 课时数列：填写数字，表示学生实际上课次数
- 备注列：包含以下关键词的学生将被自动排除（不计入有效人数）

**排除关键词**：半免、免费、退费、试听、休学、退学、退款、取消

示例表头：
| 姓名 | 上课次数 | 备注 |
|------|----------|------|
| 张三 | 10 | — |
| 李四 | 8 | 半免 |
| 王五 | 5 | 退费 |

## 续班率计算规则

1. **排除半免学生**：标记为半免的学生不计入有效人数
2. **排除上课不足学生**：上课课时 < 总课时/3 的学生不计入有效人数
3. **续班率计算**：(续读学生数 / 有效学生数) × 100%

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发环境
pnpm dev

# 生产构建
pnpm build

# 生产运行
pnpm start
```

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── roster/route.ts      # 点名册上传 API
│   │   └── statistics/route.ts  # 续班率统计 API
│   ├── layout.tsx               # 布局
│   └── page.tsx                 # 主页面
├── components/ui/               # shadcn/ui 组件
├── storage/database/            # Supabase 数据库相关
│   ├── shared/schema.ts         # 数据表定义
│   └── supabase-client.ts       # Supabase 客户端
└── lib/utils.ts                 # 工具函数
```
