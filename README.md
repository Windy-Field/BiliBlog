# 小B书（BiliBlog）

**路线二：AI Agent 开发**，用原生 HTML、CSS、JavaScript 和 Vite 完成前端

开发时，我尤其在意视觉效果的呈现。因此除了实现了博客的基本功能外，还接入自定义AI接口，并反复调整了视觉方面的内容，如：刷新区域、页面切换的平滑动画等

**因此，您可以重点关注以上方面的内容**

![首页效果图](screenshots/home.png)

## 项目特色（这里部分用 agent 总结）

### 自定义 AI 助手 Octorange

我把前两次作业中的设计的“印小灵”AI助手迁移到了小B书（当然，经过了SFT微调），其命名为 Octorange。宠物的回复支持 Markdown 显示，且列表、代码块和表格等都能流畅阅读

宠物有待机、悬停和思考三种状态，用户可以随意拖动宠物

猫耳朵上方会轮换显示白底问候气泡

用户可以在页脚关闭动态问候或隐藏宠物

### 平滑动画和局部刷新

我给所有页面的切换和刷新增加了平滑过渡效果，尽量避免出现闪屏等影响视觉美观的情况

### 分栏写作、草稿和编辑保护

编辑器默认使用分栏模式（左边 Markdown，右边预览），这是我认为最方便的编辑方式

草稿在停止输入约 2 秒后会自动保存（可关闭）

如果两个页面同时修改同一篇文章，则会保留本地输入，并排展示本地和服务器内容，方便核对后决定采用哪一份

### 个人主页

我的文章和本人主页可以置顶文章（最多两篇）

个人主页可以修改头像、封面、短句、Markdown 个人介绍和外部链接，也能按月份查看文章

关注页则将同一位作者的文章放在一起，方便检索

## 已实现功能（这里直接用 agent 总结了）

| 模块 | 具体内容 |
| --- | --- |
| 账号 | 注册、登录、退出、当前用户展示、刷新后确认登录状态、登录失效引导 |
| 首页 | 图文列表、关键词搜索、话题筛选、作者搜索、分页、文章发布公告 |
| 阅读 | 文章详情、图片、作者信息、文章链接直接访问与刷新、本机进度恢复、复制文章链接 |
| 创作 | 新建文章、编辑已发布文章、删除本人文章，编辑时保留图片和商品关联 |
| 草稿 | 独立草稿箱、搜索、分页、继续编辑、确认删除、自动保存、本机备份恢复 |
| 编辑保护 | 按 version 保存、串行写入、版本冲突对比、保存结果未知时回读核对、离开提醒 |
| Markdown | 编辑、预览和分栏视图，解析后清理 HTML，代码块与表格可独立滚动 |
| 图片 | 本地预览、逐张上传、素材库分页、复用已上传图片、移出文章、确认删除未使用素材 |
| 互动 | 点赞与取消、收藏与取消、主评论和一级回复、分页、删除自己的评论 |
| 阅读整理 | 最多两篇置顶、收藏夹增删改与筛选、移动收藏文章、本人点赞历史 |
| 个人主页 | 公开资料与文章、头像、封面、短句、个人介绍、外部链接、月份归档 |
| 关注 | 关注与取消、粉丝数同步、按作者分组的关注文章、关注和粉丝分页名单 |
| 通知 | 未读角标、类型与阅读状态筛选、分页、单条及全部已读、本机标记未读、跳转文章或作者 |
| 宠物 AI | Octorange 文字对话、Markdown 回复、引用展示、三种角色状态、拖动、问候与显示设置 |

未筛选的首页最新文章，第一页最多显示 22 篇，其余每页最多 20 篇；搜索、话题和私人列表每页最多 20 篇。首页会随屏幕宽度调整为 1～5 列

## 技术栈

| 用途 | 选择 |
| --- | --- |
| 页面和交互 | HTML5 + CSS3 + JavaScript |
| 开发与构建 | Node.js 24、Vite 8、npm |
| 后端通信 | Fetch、REST API |
| Markdown | marked 解析、DOMPurify 清理 HTML |
| 图标 | Lucide |
| AI | 阿里云百炼应用 API，通过 Vite 服务端插件转发 |

### AI 宠物配置说明

在项目根目录按 `.env.example` 创建 `.env.local`，填写以下两项：

```dotenv
DASHSCOPE_API_KEY=请填写百炼API密钥
DASHSCOPE_APP_ID=08f487dd5e10446287bec082430afe7f // 这个应用 ID 对应本项目使用的新百炼应用
```

开发和预览服务均通过 `tools/ai-plugin.mjs` 提供 `/api/ai/chat` 与 `/api/ai/status`

## 使用步骤（这里直接用 agent 介绍了）

1. 注册账号并登录，首页右上角会显示当前账号入口
2. 在首页浏览文章，使用关键词或话题筛选，点击封面、标题进入阅读窗口
3. 点击“发布文章”，填写标题和正文，默认可以同时看 Markdown 预览
4. 输入话题后按空格、回车或逗号添加，每篇最多 5 个，每个最多 20 个字符
5. 选择图片并点击“上传选中图片”，或从“已上传图片”选择素材，再保存草稿或发布
6. 在草稿箱继续编辑，在“我的文章”编辑、置顶或删除已发布文章
7. 在阅读窗口点赞、收藏、评论或回复，通过“我的收藏”和“点赞历史”整理阅读内容
8. 点击作者名查看主页，关注后从首页“关注”查看对应作者的文章
9. 从账号菜单进入“资料设置”，修改资料并保存，再到公开主页查看效果
10. 点击铃铛查看通知，按类型和阅读状态筛选，查看相关内容或标记已读
11. 点击右下角的猫与 Octorange 对话，显示和动态问候开关在页脚“宠物助手设置”中

## 项目结构

目录树和主要文件用途放在 [项目结构说明](project-structure.md) 中

## 注册和登录的核心代码

注册页和登录页共用 [account.js](scripts/account.js)，通过页面的 `data-mode` 判断当前操作

我把这部分理解为四步：检查输入、选择接口、提交账号信息、保存服务器返回的登录凭证

### 先检查注册信息

下面是注册校验的核心代码，`displayName`、`password` 和 `confirmPassword` 都是从表单取得的输入框，`isRegister` 由页面模式决定

```javascript
// 检查注册页的昵称和两次密码，把错误交给浏览器表单提示
function validateRegistration() {
    if (!isRegister) {
        return;
    }
    // 每次先清除旧错误，改正输入后才能继续提交
    displayName.setCustomValidity("");
    confirmPassword.setCustomValidity("");
    if (displayName.value.trim().length === 0) {
        displayName.setCustomValidity("昵称不能只包含空格");
    }
    if (password.value !== confirmPassword.value) {
        confirmPassword.setCustomValidity("两次输入的密码不一致");
    }
}
```

`setCustomValidity` 用来补充昵称和确认密码的检查，提交前再调用 `form.reportValidity()`，让浏览器一起检查必填项、长度等 HTML 规则。确认密码只在页面上比较，实际请求提交用户名、密码，以及注册时填写的昵称

### 注册和登录共用提交过程

下面摘出提交函数中的主要步骤，`requestApi` 来自 [api.js](scripts/api.js)，`saveSession` 来自 [auth.js](scripts/auth.js)，`username`、`password`、`displayName` 和 `fields` 是页面上的表单元素

```javascript
const credentials = {
    username: username.value,
    password: password.value
};
let path = "/auth/login";
if (isRegister) {
    path = "/auth/register";
    credentials.displayName = displayName.value.trim();
}

// 等待服务器时禁用表单，避免连续点击产生重复请求
submitting = true;
fields.disabled = true;
try {
    const session = await requestApi(path, "POST", credentials, null);
    saveSession(session);
    window.location.replace("/index.html");
} catch (error) {
    showMessage(message, error.message, true);
} finally {
    submitting = false;
    fields.disabled = false;
}
```

我让注册和登录只在请求路径与昵称字段上区分，其他步骤共用。`await` 等待接口结果，成功后保存凭证并跳转首页；失败时显示后端错误并保留输入，`finally` 负责恢复表单。完整函数还会在开头阻止表单默认跳转、检查 `submitting`，并处理提交按钮的等待状态

`requestApi` 使用 Fetch，把 `credentials` 转成 JSON 发送到学校后端，检查 HTTP 状态后返回响应中的 `data`。注册接口本身会返回登录会话，所以注册成功后可以直接进入已登录状态，请求最后一个参数传 `null` 表示这次验证账号时省略旧凭证

### 保存凭证，让刷新后还能继续登录

保存前，[auth.js](scripts/auth.js) 会检查 `token` 是否存在，以及 `expiresAt` 是否为有效的未来时间，核心保存语句如下

```javascript
const savedSession = {
    token: session.token,
    expiresAt: session.expiresAt
};
localStorage.setItem(SESSION_KEY, JSON.stringify(savedSession));
```

`SESSION_KEY` 来自 [config.js](scripts/config.js)，保存的内容是服务器签发的 token 和到期时间。刷新后，`readSession()` 读取这份 JSON 并检查有效期，再通过携带 `Authorization: Bearer <token>` 的请求让后端确认身份。密码只用于本次提交，浏览器的本地存储保留会话信息

## 已知问题与后续安排

| 项目 | 当前情况与后续处理 |
| --- | --- |
| AI 联网检索 | 当前应用返回缺少联网搜索工具的提示，下一步在百炼后台核对应用类型、搜索工具和发布配置，随后确认实际检索与引用结果 |
| 校园网络 | 学校接口依赖校园网络，外网部署需配置允许的跨域来源 |
| AI 部署 | 静态页面配套部署 AI 转发接口，密钥保存在服务端环境中 |
| 本机状态 | 草稿恢复、阅读进度和通知的本机未读标记保存在当前浏览器，跨设备以服务器数据为准 |
| 置顶数量 | 本站界面限制两篇，校园后端上限为三篇；其他客户端已有的置顶按服务器实际结果显示，并提供取消入口 |
| 模拟商铺 | 商品浏览、钱包充值、支付和订单页面列入后续功能，当前作品以博客阅读、创作和个人主页为主 |
| 其他扩展 | 后续考虑阅读目录、图片大图查看、深色模式，以及用本人校园照片替换首页占位横幅 |

## 设计、素材和 AI 使用说明

项目的颜色、字号、间距和组件规则维护在 `design.md`

宠物形象、三张状态图片和百炼文字会话接入方式沿用本机 Web 项目，在小B书中重新配置了新应用、角色名称、问候内容和对话显示方式。学校提供的接口文档及本地课程教程用于核对请求字段和业务约定

我使用 AI Agent 协助拆解需求、编写部分代码、分析报错和检查页面，自己确定功能范围、设计方向，并根据实际操作提出修改。阅读窗口的加载尺寸、评论刷新范围、收藏夹切换、分页数量和宠物气泡位置，都是开发中逐步核对和调整的内容
