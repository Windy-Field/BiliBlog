# 项目结构

[返回 README](README.md)

页面放在根目录，脚本、样式和工具分别放在 `scripts/`、`styles/`、`tools/`，README 中的截图统一放在 `screenshots/`

下面列出项目维护的文件及用途，依赖目录 `node_modules/` 和构建目录 `dist/` 由工具生成，本地课程资料 `markdown-export/` 由 Git 忽略

目录树中的 `start.cmd`、`package.cmd`、`tools/start-dev.ps1` 和 `tools/pack-submission.ps1` 只在本地工作区使用，不放入提交包。解压提交包后使用 `npm ci` 和 `npm run dev` 运行项目

```text
Blog/
├── start.cmd                          双击启动服务并打开首页
├── package.cmd                        双击检查、构建并生成提交 ZIP
├── index.html                         首页、搜索结果与文章阅读窗口
├── login.html                         登录页面
├── register.html                      注册页面
├── publish.html                       文章发布与编辑页面
├── drafts.html                        草稿箱，搜索、继续编辑和删除草稿
├── profile.html                       个人主页与关注操作
├── settings.html                      个人资料设置
├── scripts/
│   ├── api.js                         发送接口请求，处理文件上传、超时和错误
│   ├── auth.js                        保存、读取和清理登录凭证
│   ├── account.js                     注册和登录表单
│   ├── creator-account.js             创作页面的头像菜单和账号快捷入口
│   ├── common.js                      页面提示、等待状态和删除确认
│   ├── config.js                      共用的接口地址、限制、分页和宠物配置
│   ├── site-settings.js               导航设置窗口、写作偏好和资料设置入口
│   ├── media.js                       图片校验和本地预览
│   ├── motion.js                      面板过渡、公告滚动和导航动效
│   ├── home.js                        首页、关注分组、筛选、文章阅读与删除
│   ├── publish.js                     发布表单、图片上传与素材选择
│   ├── drafts.js                      搜索和分页读取本人草稿，核对删除结果
│   ├── editor-session.js              按顺序保存文章，处理版本冲突和结果核对
│   ├── markdown-preview.js            解析 Markdown，清理 HTML 后显示预览
│   ├── local-draft.js                 按账号读写并校验本机草稿备份
│   ├── reading-progress.js            记录和恢复正文阅读进度
│   ├── article-share.js               复制文章链接，权限受限时显示可选中的地址
│   ├── people.js                      搜索页作者结果、关注与粉丝名单
│   ├── ai-pet.js                      Octorange 状态、Markdown 对话、拖动及设置
│   ├── profile.js                     个人主页、月份归档与关注状态
│   ├── settings.js                    资料编辑、头像与封面上传
│   ├── reactions.js                   点赞、收藏与状态同步
│   ├── pins.js                        核对置顶数量，协调多个标签页的置顶操作
│   ├── collections.js                 管理和筛选收藏夹，调整文章所属的收藏夹
│   ├── comments.js                    评论列表、回复、分页和本人评论删除
│   ├── notifications.js               消息弹窗、筛选、未读数和阅读状态标记
│   └── icons.js                       公共图标
├── tools/
│   ├── check-style.mjs                JavaScript 语法风格和函数说明检查
│   ├── check-project.mjs              检查文件命名、代码和文档引用及接口限制
│   ├── ai-plugin.mjs                  转发百炼 AI 请求，限制请求大小和调用频率
│   ├── pack-submission.ps1            选择提交文件，生成 ZIP 并逐个核对文件内容
│   └── start-dev.ps1                  本机开发服务启动脚本
├── styles/
│   ├── navigation.css                 声明同站页面切换的过渡效果，由 Vite 提前注入
│   ├── common.css                     基础页面与表单样式
│   ├── buttons.css                    首页、登录和注册共用主按钮及各状态配色
│   ├── account.css                    登录与注册页面样式
│   ├── account-menu.css               首页和创作页面共用的头像菜单
│   ├── home.css                       首页、作者分组、文章卡片和不同屏幕下的网格
│   ├── reader.css                     阅读窗口、正文排版和文章互动区
│   ├── comments.css                   评论表单、主评论和一级回复样式
│   ├── publish.css                    发布表单与素材库样式
│   ├── drafts.css                     草稿列表与手机布局
│   ├── editor.css                     编辑预览、保存状态和版本冲突对比
│   ├── library.css                    置顶标记、收藏夹工具栏和操作窗口
│   ├── profile.css                    个人主页样式
│   ├── settings.css                   个人资料设置样式
│   ├── site-settings.css              全站设置入口、弹窗和开关布局
│   ├── feedback.css                   公共动效、提示与对话框反馈
│   ├── notifications.css              铃铛与消息列表样式
│   ├── select.css                     全站下拉选择框和原生菜单样式
│   ├── people.css                     作者搜索结果、名单与分页样式
│   ├── ai-pet.css                     宠物角色、对话窗口和设置布局
│   ├── pet-motion.css                 宠物图片切换和对话窗口开合动画
│   └── tokens.css                     统一颜色、字体和尺寸
├── assets/
│   ├── images/                        页面图片素材
│   │   └── forest-banner.jpg          森林横幅，作为当前首页占位素材
│   └── pet/                           猫形角色的三张状态图片
│       ├── idling.png                 待机状态
│       ├── hovering.png               鼠标悬停状态
│       └── thinking.png               等待 AI 回复时的思考状态
├── screenshots/                       README 表格中的桌面、手机和异常状态截图
│   ├── home-desktop.jpg               桌面首页
│   ├── home-mobile.jpg                手机首页
│   ├── reader-desktop.jpg             桌面文章阅读
│   ├── reader-mobile.jpg              手机文章阅读
│   ├── favorite-desktop.jpg           桌面收藏成功后选择收藏夹
│   ├── favorite-mobile.jpg            手机收藏成功后选择收藏夹
│   ├── editor-desktop.jpg             桌面 Markdown 写作，使用本机示例内容
│   ├── editor-mobile.jpg              手机 Markdown 写作，使用本机示例内容
│   ├── settings-desktop.jpg           桌面统一设置窗口
│   ├── settings-mobile.jpg            手机统一设置窗口
│   ├── feed-error-desktop.jpg         桌面列表读取失败，模拟 503 响应
│   ├── feed-error-mobile.jpg          手机列表读取失败，模拟 503 响应
│   ├── missing-article-desktop.jpg    桌面文章不存在，模拟 404 响应
│   ├── missing-article-mobile.jpg     手机文章不存在，模拟 404 响应
│   ├── login-error-desktop.jpg        桌面登录失败，模拟 401 响应
│   └── login-error-mobile.jpg         手机登录失败，模拟 401 响应
├── markdown-export/                   本地课程教程，由 Git 忽略
├── submissions/                       自动生成的提交压缩包，由 Git 忽略
├── openapi.json                       接口定义
├── design.md                          页面设计规范
├── vite.config.js                     页面构建入口
├── package.json                       依赖与运行命令
├── package-lock.json                  锁定依赖版本，安装时使用相同版本
├── .env.example                       AI 服务端环境变量示例，不含密钥
├── .gitignore                         Git 忽略规则
├── LICENSE                            项目许可文件
├── project-structure.md               目录结构及主要文件说明
└── README.md                          项目介绍、功能和使用说明
```
