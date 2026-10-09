# 对象存储迁移工具（S3 Migration Console）

带 Web 界面的 S3 兼容对象存储管理与迁移工具，支持 AWS S3、MinIO、阿里云 OSS、腾讯云 COS 等。

## 在线演示
演示站点：https://1a5l2eg.pub.atoms.world/ （演示账号 `demo` / `demo123`）

## 功能截图
| 登录页 | 迁移任务 |
|---|---|
| ![登录](screenshots/01-login.png) | ![迁移任务](screenshots/02-tasks.png) |
| **存储连接** | **对象浏览** |
| ![存储连接](screenshots/03-connections.png) | ![对象浏览](screenshots/04-browser.png) |
| **管理后台** | **修改密码** |
| ![管理后台](screenshots/05-admin.png) | ![修改密码](screenshots/06-change-password.png) |

## 技术栈
- 前端：React 18、TypeScript、Vite、Tailwind CSS、shadcn/ui、framer-motion
- 后端：Python FastAPI、boto3、SQLAlchemy（asyncpg）、PostgreSQL、JWT 认证
- 部署：Docker Compose（Postgres + 后端 + Nginx 托管前端并反代 /api）

## 功能
- 账号密码注册/登录、修改密码；用户数据相互隔离
- 存储连接管理（密钥加密保存）
- 对象浏览、上传、下载、删除
- 迁移任务：大文件流式分片复制、同端点服务端复制、断点续传、失败重试、进度与日志
- 管理后台：用户启用/禁用、角色管理、重置密码、删除普通用户、查看全部任务

## 目录结构
```
.
├── app/
│   ├── backend/        # FastAPI + boto3 + SQLAlchemy(asyncpg)
│   │   ├── routers/    # s3_* 业务接口（迁移、账号、管理后台）
│   │   ├── services/   # 迁移引擎、数据库初始化等
│   │   ├── models/     # ORM 模型
│   │   └── Dockerfile
│   └── frontend/       # React + Vite + Tailwind + shadcn/ui
│       ├── src/
│       ├── nginx.conf  # 生产环境静态托管 + /api 反向代理
│       └── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 快速部署（Docker Compose）
```bash
git clone https://github.com/SkyBiuBiu/s3-migration-tool.git
cd s3-migration-tool
cp .env.example .env      # 修改数据库密码、JWT_SECRET_KEY、MASK_KEY
docker compose up -d --build
```
访问 `http://<服务器IP>:8080`。

首次启动会按 `.env` 中的 `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` 自动创建管理员（示例为 `admin` / `ChangeMe@2024`）。`FORCE_PASSWORD_CHANGE=true` 时，该账号首次登录会弹出无法关闭的改密窗口，修改后才能使用。

运维常用命令：
```bash
docker compose ps                 # 查看各服务健康状态
docker compose logs -f backend    # 查看后端日志（同时持久化在 backend-logs 卷）
```

## 本地开发
```bash
# 后端
cd app/backend
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/s3mig JWT_SECRET_KEY=dev JWT_ALGORITHM=HS256 JWT_EXPIRE_MINUTES=10080
uvicorn main:app --reload --port 8000

# 前端（另开终端，/api 自动代理到 8000）
cd app/frontend
pnpm install && pnpm dev
```

## 测试与 CI
```bash
cd app/backend
pip install -r requirements-dev.txt
pytest -q
```
单元测试基于 moto 模拟 S3，覆盖：前缀映射、过滤规则、小文件复制与元数据保留（服务端复制 / 流式复制两条路径）、大文件分片上传、断点续传（跳过已存在）、变更检测重传、全量覆盖、失败上报与重试、时间片用完后剩余任务续跑、目录占位对象过滤、客户端缓存复用、密码哈希。

GitHub Actions（`.github/workflows/ci.yml`）在每次 push / PR 时执行：后端 ruff 检查 + pytest → 前端 lint + build → `docker compose build` 并启动整套服务，轮询 `/health` 做冒烟测试，失败时输出容器日志。

## 注意事项
- 浏览器直传大于 5MB 的文件使用预签名 URL，需要在目标 Bucket 配置 CORS（允许 PUT，暴露 ETag）。
- `MASK_KEY` 用于加密存储连接的密钥，上线后不要更改。
- 迁移在后端进程内执行，请勿将后端扩展为多副本而不加分布式锁。

---

# 设计说明

## 一、实现思路与关键取舍

### 整体架构
采用前后端分离：React 单页应用负责交互，FastAPI 负责业务与 S3 操作。**所有 S3 凭据只存在于后端**，浏览器从不接触 AccessKey/SecretKey，所有存储操作都由后端代为签名执行。

### 关键取舍

**1. 迁移在后端进程内执行，而非引入消息队列**
- 取舍：没有使用 Celery/RQ 等任务队列，迁移任务以后台协程运行，进度实时写回数据库。
- 原因：Demo 规模下引入队列会显著增加部署复杂度（多一个 Broker + Worker）。进度持久化在数据库中，进程重启后任务可继续，已能覆盖断点续传需求。
- 代价：后端无法简单地水平扩容多副本。任务通过数据库行锁 + TTL（30 分钟）防止重复执行，但真正的分布式调度需要后续改造。

**2. 大文件流式分片，不落盘**
- 跨厂商迁移时，对象从源端边读边写入目标端，使用分片上传，内存中只保留当前分片。
- 好处：迁移 10GB 文件不需要 10GB 磁盘或内存。

**3. 同端点同凭据时走服务端复制**
- 识别出源和目标属于同一账号同一地域时，直接调用 S3 的 `CopyObject`，由云厂商内部完成复制，不经过本服务器中转，速度快且不产生公网流量费。

**4. 自建账号体系，而非直接复用平台登录**
- 取舍：实现了用户名 + 密码（PBKDF2-SHA256，20 万次迭代）的独立认证，复用底层的 JWT 签发与用户表。
- 原因：这是一个可独立部署的工具，部署到自己服务器后不应依赖外部身份源。
- 代价：缺少邮箱验证、找回密码等完整账号能力。

**5. 上传按大小分流**
- ≤5MB 走后端中转（JSON + base64），实现简单、无需额外配置。
- >5MB 走预签名 URL 由浏览器直传，避免后端成为带宽瓶颈，代价是需要用户在目标 Bucket 配置 CORS。

**6. 兼容性细节**
- 腾讯云 COS 等厂商不接受 AWS SDK 默认发送的 CRC 校验尾部，因此全局关闭了 checksum 的强制计算与校验；批量删除补发 Content-MD5 头；寻址方式区分 virtual-host 与 path-style。这些是实测踩坑后针对性修复的。

## 二、当前完成程度

### 已完成
- **账号体系**：注册、登录、修改密码；JWT 鉴权；用户数据完全隔离
- **权限管理**：普通用户 / 管理员 / 已禁用三种状态；管理员可改角色、启停账号、重置普通用户密码、删除普通用户（级联删除其连接与任务）；管理员之间互不可操作
- **存储连接**：增删改查，连接测试，密钥加密存储，支持自定义 endpoint、地域与寻址方式
- **对象浏览**：按目录层级浏览、上传、下载、删除、批量删除
- **迁移任务**：按前缀迁移、实时进度与速率、成功/跳过/失败计数、失败重试、取消、任务日志、断点续传、同端点服务端复制
- **管理后台**：用户列表、全部任务只读视图
- **部署**：Docker Compose 一键启动（Postgres + 后端 + Nginx）

### 未完成 / 已知限制
- **测试覆盖有限**：迁移引擎已有单元测试，但 HTTP 接口层、任务调度循环与前端尚无自动化测试
- **单实例限制**：后端多副本部署时任务调度会冲突
- **账号能力不全**：无邮箱验证、无找回密码、无操作审计日志
- **迁移能力边界**：不支持对象元数据/ACL/存储类型的完整保留，不支持增量同步（仅按前缀全量），不支持定时任务
- **前端细节**：超大目录（万级对象）未做虚拟滚动，列表仅分页
- **安全**：演示站点保留 demo/demo123 便于体验；自部署时默认管理员由环境变量配置，并强制首次登录改密

## 三、后续扩展规划

### P0 — 生产可用的必要补强（✅ 已完成）
1. ✅ **自动化测试与 CI**：`app/backend/tests/` 用 moto 模拟 S3，为迁移引擎补了 13 个单元测试，覆盖分片上传、失败重试、断点续传、同步模式与时间片续跑；GitHub Actions 依次运行 lint、单元测试、前端构建和镜像构建。
2. ✅ **Docker 部署完善**：后端、前端、数据库三个服务都配置了健康检查，前端要等后端健康后才启动；后端日志持久化到 `backend-logs` 卷，容器日志自动轮转；为每个服务设置了 CPU 和内存上限。CI 会在干净的 Runner 上完整构建，启动后做 `/health` 冒烟测试。
3. ✅ **默认账号与强制改密**：默认管理员的用户名和密码改为通过环境变量配置，不再写死在代码里；`FORCE_PASSWORD_CHANGE=true` 时，仍在使用初始密码的账号登录后会弹出无法关闭的改密窗口；新密码不能与原密码相同。

### P1 — 核心能力增强
4. **任务队列与多副本**：引入 Redis + 独立 Worker，让迁移与 Web 服务解耦，支持横向扩容和任务并发度控制。这是从「可用」走向「能扛量」的关键一步。
5. **增量同步与定时任务**：按 ETag/LastModified 比对实现增量迁移，配合 cron 表达式做周期同步，这是对象存储迁移最高频的真实诉求。
6. **元数据完整保留**：Content-Type、自定义 Header、存储类型、ACL 的映射与保留。

### P2 — 体验与运维
7. **迁移校验报告**：迁移后全量比对大小与 ETag，输出差异清单并支持一键修复。
8. **操作审计日志**：记录谁在何时操作了哪个连接与任务，管理员可查。
9. **大目录虚拟滚动 + 搜索**：提升万级对象场景下的浏览体验。
10. **多语言与主题**：国际化与深色模式。

**优先级判断依据**：P0 解决的是「这套代码能不能安全地交给别人用」，是协作与交付的前提；P1 解决的是「能不能扛住真实生产场景的量级和频次」，直接决定工具的实用价值；P2 属于锦上添花，在前两者稳固后才有投入意义。
