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

首次启动会自动创建默认管理员 **demo / demo123**，登录后请立即通过「修改密码」更改。

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

## 注意事项
- 浏览器直传大于 5MB 的文件使用预签名 URL，需要在目标 Bucket 配置 CORS（允许 PUT，暴露 ETag）。
- `MASK_KEY` 用于加密存储连接的密钥，上线后不要更改。
- 迁移在后端进程内执行，请勿将后端扩展为多副本而不加分布式锁。
