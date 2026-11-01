# Project Instructions

- 项目中文名为“小B书”，英文名和技术标识为 BiliBlog，命名细节见 design.md
- 注释只保留函数用途、关键步骤和容易出错的地方，表达自然，避免逐行解释语法
- 注释和面向用户的回复结尾不加句号
- 用户是刚入门的大一学生。进度更新保持简短，仅说明必要决定、阻碍和检查结果。
- 新建页面或修改界面前，必须先完整阅读项目根目录的 design.md，并遵循其中的统一设计规范。需要改变规范时明确说明并同步更新 design.md。
- 写代码前必须读取 C:\Users\lenovo\.claude\hooks\code-style-rules.md。代码风格规则仅维护在该文件，不在本项目复制或改写其内容。
- 先检查现有文件和用户改动，优先复用已有实现；接口行为以 openapi.json 和 markdown-export 中的说明为依据。
- 完成任务后删除此次创建的临时脚本，不删除用户文件。
- 后续代码优化继续遵守上述唯一代码风格文件，提交结果前运行 npm run check 和相关功能验证
- 共享配置维护在 scripts/config.js，样式数值维护在 styles/tokens.css，界面反馈维护在 scripts/common.js，纯动效维护在 scripts/motion.js
