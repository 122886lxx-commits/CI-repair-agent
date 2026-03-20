# CI Repair Agent

生产级 v1 骨架，面向 `GitHub + GitHub Actions` 的内部 CI 修复控制面。

## 核心能力

- 控制面 API：创建任务、查看任务、审批、拒绝、rerun
- Web 控制台：任务列表、任务详情、Diff、审批、审计
- Worker：轮询队列并驱动 Orchestrator 流程
- GitHub 集成：workflow run 上下文读取、OAuth 登录、Draft PR 接口
- 风险闸门：workflow、auth、数据库、删除、依赖升级等高风险变更自动进入人工审批
- Live sandbox：开启 `LIVE_SANDBOX=true` 后，系统会克隆仓库、应用补丁、推断验证命令并在容器内执行
- PostgreSQL 持久化：Job、TaskGraph、ApprovalGate、EvalResult、AuditEvent

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 复制环境变量

```bash
cp .env.example .env
```

3. 启动 PostgreSQL

```bash
docker compose up -d postgres
```

4. 启动控制台

```bash
npm run dev
```

5. 启动 worker

```bash
npm run dev:worker
```

默认 `AUTH_BYPASS=true`，本地开发会直接以 `local-operator` 身份登录。生产环境应关闭绕过并配置 GitHub OAuth、GitHub App 和 PostgreSQL。

如果要启用真实修复流，需要额外配置：

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `LIVE_SANDBOX=true`
- 本机可用 `git` 与 `docker`

## API

- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/diff`
- `POST /api/jobs/:id/approve`
- `POST /api/jobs/:id/reject`
- `POST /api/jobs/:id/rerun`
- `POST /api/github/webhooks`

## 生产说明

这个 v1 已经实现了：

- 任务建模、任务图、风险闸门、评测和审计的主数据流
- GitHub OAuth、GitHub App、真实分支推送和 Draft PR 的执行路径
- 单租户内部云服务的控制面结构
- live sandbox 下的仓库克隆、补丁应用、命令推断和容器化验证

它还没有完整实现：

- 实仓库克隆后对真实 patch 的应用与 push
- 多模型路由
- 实时日志流
- 多租户隔离和计费
