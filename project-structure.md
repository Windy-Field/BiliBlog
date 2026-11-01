# 项目结构

[返回 README](README.md)

页面放在根目录，脚本和样式分别放在 `scripts/`、`styles/`，下面列出主要文件及用途

```text
Blog/
├── start.cmd               双击启动服务并打开首页
├── index.html              首页、搜索结果与文章阅读窗口
├── login.html              登录页面
├── register.html           注册页面
├── publish.html            文章发布与编辑页面
├── drafts.html             创作中心草稿管理页面
├── profile.html            个人主页与关注操作
├── settings.html           个人资料设置
├── scripts/
│   ├── api.js              公共请求、文件表单与错误处理
│   ├── auth.js             登录凭证的保存、读取和清理
│   ├── account.js          注册和登录表单
│   ├── creator-account.js  创作页面头像菜单与账号快捷跳转
│   ├── common.js           页面提示、等待状态和删除确认
│   ├── config.js           共享接口限制、分页参数和素材配置
│   ├── media.js            图片校验和本地预览
│   ├── motion.js           面板过渡、公告滚动和导航动效
│   ├── home.js             首页、关注分组、筛选、文章阅读与删除
│   ├── publish.js          发布表单、图片上传与素材选择
│   ├── drafts.js           本人草稿搜索、分页和删除状态核对
│   ├── editor-session.js   编辑版本、保存串行和未知结果核对
│   ├── markdown-preview.js Markdown 解析与安全预览
│   ├── local-draft.js      本机编辑备份的校验、读写和账号隔离
│   ├── reading-progress.js 正文阅读进度记录和恢复
│   ├── article-share.js    复制文章链接及权限失败回退
│   ├── people.js           搜索页作者结果、关注与粉丝名单
│   ├── ai-pet.js           Octorange 状态、Markdown 对话、拖动及设置
│   ├── profile.js          个人主页、月份归档与关注状态
│   ├── settings.js         资料编辑、头像与封面上传
│   ├── reactions.js        点赞、收藏与状态同步
│   ├── pins.js             本人文章置顶、数量核对与跨标签页互斥
│   ├── collections.js      私人收藏夹管理、筛选与文章移动
│   ├── comments.js         评论列表、回复、分页和本人评论删除
│   ├── notifications.js    消息弹窗、筛选、未读数与已读操作
│   └── icons.js            公共图标
├── tools/
│   ├── check-style.mjs     JavaScript 语法风格和函数说明检查
│   ├── check-project.mjs   文件命名、引用、导出使用和接口限制检查
│   ├── ai-plugin.mjs       服务端百炼应用转发与限流
│   └── start-dev.ps1       本机开发服务启动脚本
├── styles/
│   ├── navigation.css      Vite 提前注入的页面跳转声明
│   ├── common.css          基础页面与表单样式
│   ├── account.css         登录与注册页面样式
│   ├── account-menu.css    首页和创作页面共用的头像菜单
│   ├── home.css            首页、作者分组和阅读窗口
│   ├── comments.css        评论表单、主评论和一级回复样式
│   ├── publish.css         发布表单与素材库样式
│   ├── drafts.css          草稿列表与手机布局
│   ├── editor.css          编辑预览、保存状态与冲突对比
│   ├── library.css         置顶标记、收藏夹工具栏和操作窗口
│   ├── profile.css         个人主页样式
│   ├── settings.css        个人资料设置样式
│   ├── feedback.css        公共动效、提示与对话框反馈
│   ├── notifications.css   铃铛与消息列表样式
│   ├── select.css          全站下拉选择框和原生菜单样式
│   ├── people.css          作者搜索结果、名单与分页样式
│   ├── ai-pet.css          宠物角色、对话窗口和设置布局
│   ├── pet-motion.css      宠物图片切换与浮层开合动效
│   └── tokens.css          统一颜色、字体和尺寸
├── assets/images/          项目图片素材
├── assets/pet/             猫形角色的三张状态图片
├── screenshots/            README 使用的页面截图
├── markdown-export/        本地课程教程，由 Git 忽略
├── openapi.json            接口定义
├── design.md               页面设计规范
├── AGENTS.md               项目协作约定
├── vite.config.js          页面构建入口
├── package.json            依赖与运行命令
├── package-lock.json       依赖版本记录
├── .env.example            环境变量示例
├── .gitignore              Git 忽略规则
├── LICENSE                 项目许可文件
├── project-structure.md    目录结构及主要文件说明
└── README.md               项目介绍、功能和使用说明
```
