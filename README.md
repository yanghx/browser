# Browser

Chrome MCP 中间件 — 为 AI Agent 提供简化的浏览器自动化能力。

通过持久化守护进程连接用户的真实 Chrome 浏览器，复用已有的登录会话，让 AI Agent 可以像人一样浏览网页、操作表单、调用网站 API。

## 架构

```
MCP 客户端 (Claude 等 AI Agent)
    │
    ▼
MCP Server (browser-mcp)          ← 注册 browser() 工具
    │
    ▼
Daemon (browser-daemon:19825)     ← 持久化 HTTP 服务，管理多会话
    │
    ▼
Chrome Client                     ← 通过 stdio 与 chrome-devtools-mcp 通信
    │
    ▼
Chrome 浏览器                      ← 用户真实浏览器，复用登录状态
```

**三个入口**：

| 命令 | 说明 |
|------|------|
| `browser` | CLI 工具，支持交互式 REPL 和单命令模式 |
| `browser-mcp` | MCP Server，供 AI Agent 调用 |
| `browser-daemon` | 后台守护进程，维持 Chrome 持久连接 |

## 安装

```bash
npm install
npm run build
```

### 在 Claude 中配置 MCP Server

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/path/to/dist/index.js"]
    }
  }
}
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `BROWSER_URL` | Chrome 远程调试端口 URL | 自动连接 |
| `BROWSER_DAEMON_PORT` | 守护进程端口 | `19825` |
| `CHROME_MCP_COMMAND` | chrome-devtools-mcp 启动命令 | `npx` |
| `CHROME_MCP_ARGS` | chrome-devtools-mcp 参数 | `chrome-devtools-mcp@latest --autoConnect` |

## 命令参考

### 浏览与导航

```bash
browse <url>              # 打开页面，提取内容为 Markdown
back / forward            # 前进/后退
wait <text>               # 等待页面出现指定文本
```

### DOM 交互

```bash
click <target>            # 点击元素（支持 UID、CSS 选择器、文本描述）
fill <target> <value>     # 填写输入框
type <target> <value>     # 在当前焦点元素输入文本
press <key>               # 按键（Enter、Tab、Escape 等）
hover <target>            # 悬停
scroll up|down            # 滚动页面
select <target> <value>   # 下拉选择
```

### 页面观察

```bash
snapshot                  # 获取页面无障碍树（含元素 UID）
screenshot [--output path]  # 截图
search <query>            # 搜索匹配文本的元素
state                     # 页面状态摘要（链接、表单、错误）
```

### 数据提取

```bash
extract <selector> [--format json|markdown|csv]  # 结构化数据提取
eval <script>             # 在浏览器中执行 JavaScript
network [--type xhr,fetch]  # 查看网络请求
```

### 标签页管理

```bash
tab list                  # 列出所有标签页
tab new <url>             # 新建标签页
tab select <id>           # 切换标签页
close <id>                # 关闭标签页
```

### 守护进程

```bash
browser daemon            # 启动后台守护进程
browser stop              # 停止守护进程
browser status            # 查看守护进程状态
```

## Site Recipes（站点配方）

Site Recipe 是一套在浏览器标签页内执行的脚本系统，通过 `fetch()` 直接调用网站 API，复用浏览器的登录 Cookie 进行鉴权，无需单独管理 token。

### 配方目录

| 目录 | 说明 | 优先级 |
|------|------|--------|
| `~/.md-browser/sites/` | 本地/私有配方 | 高 |

文件组织为 `{platform}/{action}.js`，例如 `twitter/search.js` 对应配方名 `twitter/search`。

### 使用

```bash
site list                              # 列出所有可用配方
site twitter/search <query>            # 搜索推文
site twitter/thread <tweet_id>         # 获取推文串
site twitter/user <screen_name>        # 获取用户信息
site github/repo <owner/repo>          # 获取仓库信息
site gmail/inbox [--limit N]           # 查看 Gmail 收件箱
site gmail/send --to X --subject X --body X  # 发送邮件
site shopee/search <keyword>           # 搜索 Shopee 商品
site shopee/detail <url>               # 商品详情
```

### 平台快捷方式

```bash
x search <query>          # → site twitter/search <query>
gh repo <owner/repo>      # → site github/repo <owner/repo>
gm inbox                  # → site gmail/inbox
gm search <query>         # → site gmail/search <query>
hn top                    # → site hackernews/top
```

### 编写配方

配方文件是一个 `.js` 文件，包含 `@params` 元数据块和一个异步函数：

```javascript
/* @params
{
  "name": "twitter/search",
  "description": "Search tweets",
  "domain": "x.com",
  "args": {
    "query": { "required": true, "description": "搜索关键词" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "browser site twitter/search AI"
}
*/

async function(args) {
  // 在浏览器标签页中执行，可直接使用 fetch() 和 document.cookie
  const csrf = document.cookie.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('ct0='))?.split('=')[1];

  const resp = await fetch('/i/api/graphql/.../SearchTimeline?...', {
    headers: { 'x-csrf-token': csrf, 'Authorization': 'Bearer ...' },
    credentials: 'include',
  });

  const d = await resp.json();
  return { count: d.results.length, results: d.results };
}
```

## 开发者工具

### 录制与回放

```bash
trace start               # 开始录制浏览器中的用户操作
trace stop                # 停止录制，返回事件列表
trace status              # 查看录制状态
dev codegen <file>        # 从录制的 trace JSON 生成 TypeScript/Python 代码
dev replay <file>         # 回放录制的操作
```

### API 逆向工程

```bash
dev cli <url> [--output dir]   # 自动分析网站 API 调用，生成 @params 配方
```

工作流程：
1. 向页面注入 fetch/XHR 拦截器
2. 重新加载页面，捕获所有 API 请求
3. 分析鉴权模式（Cookie / Bearer + CSRF / Webpack 注入）
4. 生成配方模板和分析报告

### 页面检查

```bash
dev inspect [selector]         # 检查页面元素
dev test-selector <selector>   # 测试 CSS 选择器
dev test-script <js>           # 测试 JavaScript 代码片段
dev network-log                # 捕获网络请求，用于 API 发现
```

## 页面管理

系统采用 **一域名一标签页** 策略：

- 同一域名的请求会复用已有的标签页，而非重复打开
- 域名到标签页的映射自动缓存，导航或交互后自动失效
- 并发请求同一域名时自动去重，避免竞争条件

## CLI 使用

```bash
# 交互式 REPL
browser -i

# 单命令执行
browser browse https://example.com
browser site twitter/search "machine learning"

# 通过守护进程（默认，如守护进程已启动）
browser browse https://example.com

# 直连模式（跳过守护进程）
browser --direct browse https://example.com

# JSON 输出
browser --json eval document.title
```

## MCP 调用示例

```javascript
// AI Agent 通过 MCP 调用
browser({ command: "browse https://example.com" })
browser({ command: "site twitter/search AI agents" })
browser({ command: "click 登录" })
browser({ command: "fill #username alice" })
browser({ command: "eval document.title", sessionId: "session-2" })
```

## 技术栈

- **TypeScript** + ES Modules
- **@modelcontextprotocol/sdk** — MCP 协议实现
- **chrome-devtools-mcp** — Chrome DevTools 协议桥接
- **Zod** — 参数校验
- **tsup** — 构建打包
- **Node.js** >= 18.0.0

## 开发

```bash
# 开发模式（文件变更自动重新构建）
npm run dev

# 构建
npm run build

# 启动 MCP Server
npm start

# 启动 CLI
npm run cli

# 启动守护进程
npm run daemon
```
